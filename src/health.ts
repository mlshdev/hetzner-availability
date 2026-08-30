import { dirname } from "node:path";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";

export type HealthStatus = "pending" | "ok" | "error";
export type DependencyName = "awsSes" | "hetznerApi";

export interface HealthRecord {
  readonly status: HealthStatus;
  readonly checkedAt: string | null;
  readonly message: string;
}

export interface HealthState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly awsSes: HealthRecord;
  readonly hetznerApi: HealthRecord;
  readonly availabilityCheck: HealthRecord;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHealthRecord(value: unknown, name: string): HealthRecord {
  if (
    !isRecord(value) ||
    (value["status"] !== "pending" &&
      value["status"] !== "ok" &&
      value["status"] !== "error") ||
    (value["checkedAt"] !== null && typeof value["checkedAt"] !== "string") ||
    typeof value["message"] !== "string"
  ) {
    throw new Error(`Health state contains an invalid ${name} record`);
  }
  return {
    status: value["status"],
    checkedAt: value["checkedAt"],
    message: value["message"],
  };
}

export function parseHealthState(value: unknown): HealthState {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    typeof value["updatedAt"] !== "string"
  ) {
    throw new Error("Health state has an invalid structure");
  }
  return {
    version: 1,
    updatedAt: value["updatedAt"],
    awsSes: parseHealthRecord(value["awsSes"], "AWS SES"),
    hetznerApi: parseHealthRecord(value["hetznerApi"], "Hetzner API"),
    availabilityCheck: parseHealthRecord(
      value["availabilityCheck"],
      "availability check",
    ),
  };
}

export function assertHealthy(
  state: HealthState,
  maximumAgeMs: number,
  nowMs: number = Date.now(),
): void {
  const updatedAt = Date.parse(state.updatedAt);
  if (!Number.isFinite(updatedAt) || nowMs - updatedAt > maximumAgeMs) {
    throw new Error("Monitor health state is missing or stale");
  }
  if (state.awsSes.status !== "ok") {
    throw new Error(
      `AWS SES health is ${state.awsSes.status}: ${state.awsSes.message}`,
    );
  }
  if (state.hetznerApi.status !== "ok") {
    throw new Error(
      `Hetzner API health is ${state.hetznerApi.status}: ${state.hetznerApi.message}`,
    );
  }
  if (state.availabilityCheck.status !== "ok") {
    throw new Error(
      `Availability check health is ${state.availabilityCheck.status}: ${state.availabilityCheck.message}`,
    );
  }
}

function pendingRecord(message: string): HealthRecord {
  return { status: "pending", checkedAt: null, message };
}

export class HealthReporter {
  readonly #path: string;
  #state: HealthState;

  constructor(path: string) {
    this.#path = path;
    this.#state = {
      version: 1,
      updatedAt: new Date().toISOString(),
      awsSes: pendingRecord("AWS SES validation has not completed"),
      hetznerApi: pendingRecord("Hetzner API validation has not completed"),
      availabilityCheck: pendingRecord("Availability check has not completed"),
    };
  }

  async initialize(): Promise<void> {
    await this.#persist();
  }

  async recordDependency(
    name: DependencyName,
    status: Exclude<HealthStatus, "pending">,
    message: string,
    checkedAt: Date = new Date(),
  ): Promise<void> {
    this.#state = {
      ...this.#state,
      updatedAt: checkedAt.toISOString(),
      [name]: {
        status,
        checkedAt: checkedAt.toISOString(),
        message,
      },
    };
    await this.#persist();
  }

  async recordAvailabilityCheck(
    status: Exclude<HealthStatus, "pending">,
    message: string,
    checkedAt: Date = new Date(),
  ): Promise<void> {
    this.#state = {
      ...this.#state,
      updatedAt: checkedAt.toISOString(),
      availabilityCheck: {
        status,
        checkedAt: checkedAt.toISOString(),
        message,
      },
    };
    await this.#persist();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${process.pid}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(this.#state, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporaryPath, this.#path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
