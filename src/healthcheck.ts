import { readFile } from "node:fs/promises";

import { assertHealthy, parseHealthState } from "./health.ts";

const healthStateFile =
  Bun.env["HEALTH_STATE_FILE"]?.trim() || "/tmp/monitor-health.json";
const configuredPollInterval = Number(Bun.env["POLL_INTERVAL_SECONDS"] ?? "60");
const pollIntervalSeconds =
  Number.isFinite(configuredPollInterval) && configuredPollInterval > 0
    ? configuredPollInterval
    : 60;
const configuredRequestTimeout = Number(
  Bun.env["REQUEST_TIMEOUT_SECONDS"] ?? "15",
);
const requestTimeoutSeconds =
  Number.isFinite(configuredRequestTimeout) && configuredRequestTimeout > 0
    ? configuredRequestTimeout
    : 15;
const maximumAgeMs =
  Math.max(120, pollIntervalSeconds * 3 + requestTimeoutSeconds * 4) * 1_000;

try {
  const rawValue: unknown = JSON.parse(await readFile(healthStateFile, "utf8"));
  const state = parseHealthState(rawValue);
  assertHealthy(state, maximumAgeMs);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "error",
      message: "Container health check failed",
      service: "hetzner-availability-monitor",
      environment: Bun.env["ENVIRONMENT"]?.trim() || "production",
      version: Bun.env["APP_VERSION"]?.trim() || "development",
      revision: Bun.env["APP_REVISION"]?.trim() || "unknown",
      health_state_file: healthStateFile,
      maximum_age_seconds: maximumAgeMs / 1_000,
      error_message: message,
    }),
  );
  process.exit(1);
}
