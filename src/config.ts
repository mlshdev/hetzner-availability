import {
  parseLocationName,
  parseServerTypeName,
  type LocationName,
  type ServerTypeName,
} from "./domain.ts";
import { isLogLevel, type LogLevel } from "./logger.ts";

export interface Config {
  readonly hetznerApiToken: string;
  readonly serverTypes: readonly ServerTypeName[];
  readonly locations: readonly LocationName[];
  readonly awsAccessKeyId: string;
  readonly awsSecretAccessKey: string;
  readonly awsSessionToken: string | undefined;
  readonly awsRegion: string;
  readonly sesFromEmail: string;
  readonly sesRecipientEmail: string;
  readonly pollIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly stateFile: string;
  readonly healthStateFile: string;
  readonly environment: string;
  readonly logLevel: LogLevel;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 15;

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function seconds(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = optional(environment, name);
  const value = rawValue === undefined ? defaultValue : Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value * 1_000;
}

function commaSeparatedValues<T>(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  parse: (value: string) => T,
): readonly T[] {
  const values = required(environment, name)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(parse);
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one comma-separated value`);
  }
  return [...new Set(values)];
}

function logLevel(
  environment: Readonly<Record<string, string | undefined>>,
): LogLevel {
  const value = optional(environment, "LOG_LEVEL") ?? "debug";
  if (!isLogLevel(value)) {
    throw new Error("LOG_LEVEL must be one of: debug, info, warning, error");
  }
  return value;
}

export function readConfig(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Config {
  return {
    hetznerApiToken: required(environment, "HETZNER_API_TOKEN"),
    serverTypes: commaSeparatedValues(
      environment,
      "HETZNER_SERVER_TYPES",
      parseServerTypeName,
    ),
    locations: commaSeparatedValues(
      environment,
      "HETZNER_LOCATIONS",
      parseLocationName,
    ),
    awsAccessKeyId: required(environment, "AWS_ACCESS_KEY_ID"),
    awsSecretAccessKey: required(environment, "AWS_SECRET_ACCESS_KEY"),
    awsSessionToken: optional(environment, "AWS_SESSION_TOKEN"),
    awsRegion: required(environment, "AWS_REGION"),
    sesFromEmail: required(environment, "SES_FROM_EMAIL"),
    sesRecipientEmail: required(environment, "SES_RECIPIENT_EMAIL"),
    pollIntervalMs: seconds(
      environment,
      "POLL_INTERVAL_SECONDS",
      DEFAULT_POLL_INTERVAL_SECONDS,
      30,
      86_400,
    ),
    requestTimeoutMs: seconds(
      environment,
      "REQUEST_TIMEOUT_SECONDS",
      DEFAULT_REQUEST_TIMEOUT_SECONDS,
      1,
      120,
    ),
    stateFile:
      optional(environment, "STATE_FILE") ?? "/data/availability-state.json",
    healthStateFile:
      optional(environment, "HEALTH_STATE_FILE") ?? "/tmp/monitor-health.json",
    environment: optional(environment, "ENVIRONMENT") ?? "production",
    logLevel: logLevel(environment),
  };
}
