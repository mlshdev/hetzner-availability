import { readConfig } from "./config.ts";
import {
  createLogger,
  errorFields,
  isLogLevel,
  type Logger,
} from "./logger.ts";
import { runMonitor } from "./monitor.ts";

const environment = Bun.env["ENVIRONMENT"]?.trim() || "production";
const requestedLogLevel = Bun.env["LOG_LEVEL"]?.trim() || "debug";
let logger: Logger = createLogger(
  environment,
  isLogLevel(requestedLogLevel) ? requestedLogLevel : "debug",
);
const abortController = new AbortController();

const stop = (signal: string): void => {
  logger.info("Shutdown signal received", { signal });
  abortController.abort();
};
const onSigint = (): void => stop("SIGINT");
const onSigterm = (): void => stop("SIGTERM");

process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

try {
  logger.info("Application startup initiated", {
    bun_version: Bun.version,
    process_id: process.pid,
    platform: process.platform,
    architecture: process.arch,
  });
  const config = readConfig();
  logger = createLogger(config.environment, config.logLevel);
  logger.info("Configuration validation completed", {
    credentials_present: {
      hetzner_api_token: true,
      aws_access_key_id: true,
      aws_secret_access_key: true,
      aws_session_token: config.awsSessionToken !== undefined,
    },
    server_types: config.serverTypes.map((value) => value.toUpperCase()),
    locations: config.locations,
    monitored_pair_count: config.serverTypes.length * config.locations.length,
    aws_region: config.awsRegion,
    from_email: config.sesFromEmail,
    recipient_email: config.sesRecipientEmail,
    poll_interval_seconds: config.pollIntervalMs / 1_000,
    request_timeout_seconds: config.requestTimeoutMs / 1_000,
    log_level: config.logLevel,
  });
  await runMonitor(config, logger, abortController.signal);
} catch (error) {
  logger.error("Availability monitor terminated", errorFields(error));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
}
