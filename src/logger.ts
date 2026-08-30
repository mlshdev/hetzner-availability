export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type LogFields = Readonly<Record<string, JsonValue>>;
export type LogLevel = "debug" | "info" | "warning" | "error";

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warning", "error"];
const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.some((level) => level === value);
}

function writeLog(
  environment: string,
  minimumLevel: LogLevel,
  severity: LogLevel,
  message: string,
  fields: LogFields,
): void {
  if (LOG_LEVEL_PRIORITY[severity] < LOG_LEVEL_PRIORITY[minimumLevel]) {
    return;
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      severity,
      message,
      service: "hetzner-availability-monitor",
      environment,
      version: Bun.env["APP_VERSION"]?.trim() || "development",
      revision: Bun.env["APP_REVISION"]?.trim() || "unknown",
      ...fields,
    }),
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorFields(error: unknown): LogFields {
  const fields: Record<string, JsonValue> = {};
  if (error instanceof Error) {
    fields["error_name"] = error.name;
    fields["error_message"] = error.message;
    fields["error_stack"] = error.stack ?? null;
  } else {
    fields["error_message"] = String(error);
  }

  if (isRecord(error) && isRecord(error["$metadata"])) {
    const metadata = error["$metadata"];
    if (typeof metadata["requestId"] === "string") {
      fields["aws_request_id"] = metadata["requestId"];
    }
    if (typeof metadata["httpStatusCode"] === "number") {
      fields["http_status_code"] = metadata["httpStatusCode"];
    }
    if (typeof metadata["attempts"] === "number") {
      fields["aws_attempts"] = metadata["attempts"];
    }
    if (typeof metadata["totalRetryDelay"] === "number") {
      fields["aws_total_retry_delay_ms"] = metadata["totalRetryDelay"];
    }
  }
  return fields;
}

export function createLogger(
  environment: string,
  minimumLevel: LogLevel,
): Logger {
  return {
    debug(message, fields = {}) {
      writeLog(environment, minimumLevel, "debug", message, fields);
    },
    info(message, fields = {}) {
      writeLog(environment, minimumLevel, "info", message, fields);
    },
    warn(message, fields = {}) {
      writeLog(environment, minimumLevel, "warning", message, fields);
    },
    error(message, fields = {}) {
      writeLog(environment, minimumLevel, "error", message, fields);
    },
  };
}
