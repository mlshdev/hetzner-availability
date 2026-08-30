import type { Config } from "./config.ts";
import { availabilityKey, type AvailabilityStatus } from "./domain.ts";
import { HealthReporter } from "./health.ts";
import { HetznerClient } from "./hetzner.ts";
import {
  errorFields,
  errorMessage,
  type JsonValue,
  type Logger,
} from "./logger.ts";
import { SesNotifier } from "./notifier.ts";
import {
  createState,
  loadState,
  saveState,
  statesHaveSameStatuses,
  type AvailabilityState,
} from "./state.ts";

export function findNewlyAvailable(
  previousState: AvailabilityState,
  currentStatuses: readonly AvailabilityStatus[],
): readonly AvailabilityStatus[] {
  return currentStatuses.filter(
    (status) =>
      status.available &&
      previousState.statuses[availabilityKey(status)] !== true,
  );
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function statusesForLog(
  statuses: readonly AvailabilityStatus[],
): readonly Readonly<Record<string, JsonValue>>[] {
  return statuses.map((status) => ({
    server_type: status.serverType.toUpperCase(),
    location: status.location,
    available: status.available,
    status: status.available ? "AVAILABLE" : "unavailable",
  }));
}

export async function runMonitor(
  config: Config,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> {
  logger.debug("Loading persisted availability state", {
    state_file: config.stateFile,
  });
  let state = await loadState(config.stateFile);
  let stateNeedsSaving = false;
  logger.info("Persisted availability state loaded", {
    state_file: config.stateFile,
    state_updated_at: state.updatedAt,
    saved_status_count: Object.keys(state.statuses).length,
  });

  const notifier = new SesNotifier(config, logger);
  const hetzner = new HetznerClient(
    config.hetznerApiToken,
    config.requestTimeoutMs,
    logger,
  );
  const health = new HealthReporter(config.healthStateFile);
  await health.initialize();
  logger.debug("Initial pending health state written", {
    health_state_file: config.healthStateFile,
  });

  try {
    logger.info("Availability monitor started", {
      poll_interval_seconds: config.pollIntervalMs / 1_000,
      request_timeout_seconds: config.requestTimeoutMs / 1_000,
      server_types: config.serverTypes.map((value) => value.toUpperCase()),
      locations: config.locations,
      monitored_pair_count: config.serverTypes.length * config.locations.length,
      aws_region: config.awsRegion,
      from_email: config.sesFromEmail,
      recipient_email: config.sesRecipientEmail,
      log_level: config.logLevel,
      state_file: config.stateFile,
      health_state_file: config.healthStateFile,
    });

    while (!signal.aborted) {
      const cycleId = crypto.randomUUID();
      const cycleStartedAt = new Date();
      const cycleStartedMonotonic = performance.now();
      const cycleErrors: string[] = [];
      let sesHealthy = false;
      let hetznerHealthy = false;
      let latestStatuses: readonly AvailabilityStatus[] | null = null;

      logger.info("Availability monitoring cycle started", {
        cycle_id: cycleId,
        check_started_at: cycleStartedAt.toISOString(),
      });

      try {
        await notifier.validateConnection();
        sesHealthy = true;
        await health.recordDependency(
          "awsSes",
          "ok",
          `SES credentials and sending are valid in ${config.awsRegion}`,
        );
        logger.debug("AWS SES health state recorded as healthy", {
          cycle_id: cycleId,
        });
      } catch (error) {
        const message = errorMessage(error);
        cycleErrors.push(`AWS SES: ${message}`);
        await health.recordDependency("awsSes", "error", message);
        logger.error("AWS SES health state recorded as unhealthy", {
          cycle_id: cycleId,
          ...errorFields(error),
        });
      }

      try {
        await hetzner.validateToken();
        hetznerHealthy = true;
        await health.recordDependency(
          "hetznerApi",
          "ok",
          "Hetzner API token is valid",
        );
        logger.debug("Hetzner API health state recorded as healthy", {
          cycle_id: cycleId,
        });
      } catch (error) {
        const message = errorMessage(error);
        cycleErrors.push(`Hetzner API: ${message}`);
        await health.recordDependency("hetznerApi", "error", message);
        await health.recordAvailabilityCheck(
          "error",
          "Availability request skipped because Hetzner API validation failed",
        );
        logger.error("Hetzner API health state recorded as unhealthy", {
          cycle_id: cycleId,
          ...errorFields(error),
        });
      }

      if (hetznerHealthy) {
        try {
          logger.info("Fetching all configured Hetzner availability statuses", {
            cycle_id: cycleId,
            server_types: config.serverTypes.map((value) =>
              value.toUpperCase(),
            ),
            locations: config.locations,
          });
          const availabilityByType = await Promise.all(
            config.serverTypes.map((serverType) =>
              hetzner.fetchServerTypeAvailability(serverType, config.locations),
            ),
          );
          latestStatuses = availabilityByType.flat();
          const checkedAt = new Date();
          logger.info("Hetzner availability check performed", {
            cycle_id: cycleId,
            last_check_at: checkedAt.toISOString(),
            status: "success",
            statuses: statusesForLog(latestStatuses),
            available_count: latestStatuses.filter((status) => status.available)
              .length,
            unavailable_count: latestStatuses.filter(
              (status) => !status.available,
            ).length,
          });

          const newlyAvailable = findNewlyAvailable(state, latestStatuses);
          let stateCanAdvance = true;
          if (newlyAvailable.length === 0) {
            logger.info("No new Hetzner availability transition detected", {
              cycle_id: cycleId,
              last_check_at: checkedAt.toISOString(),
            });
          } else if (!sesHealthy) {
            stateCanAdvance = false;
            logger.warn(
              "New availability detected but alert remains pending because AWS SES is unhealthy",
              {
                cycle_id: cycleId,
                newly_available: statusesForLog(newlyAvailable),
              },
            );
          } else {
            logger.info("New Hetzner availability transition detected", {
              cycle_id: cycleId,
              newly_available: statusesForLog(newlyAvailable),
            });
            try {
              const messageId = await notifier.sendAvailabilityAlert(
                newlyAvailable,
                latestStatuses,
                checkedAt,
              );
              logger.info("Availability notification workflow completed", {
                cycle_id: cycleId,
                message_id: messageId ?? null,
                newly_available: statusesForLog(newlyAvailable),
              });
            } catch (error) {
              stateCanAdvance = false;
              sesHealthy = false;
              const message = errorMessage(error);
              cycleErrors.push(`AWS SES SendEmail: ${message}`);
              await health.recordDependency("awsSes", "error", message);
            }
          }

          if (stateCanAdvance) {
            const nextState = createState(latestStatuses, checkedAt);
            if (!statesHaveSameStatuses(state, nextState)) {
              state = nextState;
              stateNeedsSaving = true;
              logger.debug("Availability state changed in memory", {
                cycle_id: cycleId,
                state_updated_at: state.updatedAt,
                status_count: Object.keys(state.statuses).length,
              });
            } else {
              logger.debug("Availability state is unchanged", {
                cycle_id: cycleId,
              });
            }
          }

          if (stateNeedsSaving) {
            try {
              logger.debug("Persisting availability state", {
                cycle_id: cycleId,
                state_file: config.stateFile,
              });
              await saveState(config.stateFile, state);
              stateNeedsSaving = false;
              logger.info("Availability state persisted", {
                cycle_id: cycleId,
                state_file: config.stateFile,
                state_updated_at: state.updatedAt,
              });
            } catch (error) {
              const message = errorMessage(error);
              cycleErrors.push(`State persistence: ${message}`);
              logger.error("Failed to persist availability state", {
                cycle_id: cycleId,
                state_file: config.stateFile,
                ...errorFields(error),
              });
            }
          }

          if (
            cycleErrors.some((message) =>
              message.startsWith("State persistence:"),
            )
          ) {
            await health.recordAvailabilityCheck(
              "error",
              "Availability was fetched but its state could not be persisted",
              checkedAt,
            );
          } else {
            await health.recordAvailabilityCheck(
              "ok",
              `Checked ${latestStatuses.length} server/location pairs`,
              checkedAt,
            );
          }
        } catch (error) {
          const checkedAt = new Date();
          const message = errorMessage(error);
          cycleErrors.push(`Availability check: ${message}`);
          await health.recordAvailabilityCheck("error", message, checkedAt);
          logger.error("Hetzner availability check failed", {
            cycle_id: cycleId,
            last_check_at: checkedAt.toISOString(),
            status: "error",
            ...errorFields(error),
          });
        }
      }

      const cycleCompletedAt = new Date();
      const cycleFields = {
        cycle_id: cycleId,
        last_check_at: cycleCompletedAt.toISOString(),
        check_started_at: cycleStartedAt.toISOString(),
        duration_ms: Math.round(performance.now() - cycleStartedMonotonic),
        status: cycleErrors.length === 0 ? "success" : "error",
        aws_ses_healthy: sesHealthy,
        hetzner_api_healthy: hetznerHealthy,
        statuses:
          latestStatuses === null ? null : statusesForLog(latestStatuses),
        errors: cycleErrors,
      } as const;
      if (cycleErrors.length === 0) {
        logger.info("Availability monitoring cycle completed", cycleFields);
      } else {
        logger.error(
          "Availability monitoring cycle completed with errors",
          cycleFields,
        );
      }

      logger.debug("Waiting for next availability check", {
        cycle_id: cycleId,
        next_check_in_seconds: config.pollIntervalMs / 1_000,
      });
      await wait(config.pollIntervalMs, signal);
    }
  } finally {
    notifier.destroy();
    logger.info("Availability monitor stopped");
  }
}
