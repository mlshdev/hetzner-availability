import { dirname } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import { availabilityKey, type AvailabilityStatus } from "./domain.ts";

export interface AvailabilityState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly statuses: Readonly<Record<string, boolean>>;
}

export const EMPTY_STATE: AvailabilityState = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  statuses: {},
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown): AvailabilityState {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    typeof value["updatedAt"] !== "string" ||
    !isRecord(value["statuses"])
  ) {
    throw new Error("Availability state file has an invalid structure");
  }

  const statuses: Record<string, boolean> = {};
  for (const [key, available] of Object.entries(value["statuses"])) {
    if (key.length === 0 || typeof available !== "boolean") {
      throw new Error(
        `Availability state file contains an invalid status: ${key}`,
      );
    }
    statuses[key] = available;
  }

  return { version: 1, updatedAt: value["updatedAt"], statuses };
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code?: unknown }).code === "ENOENT"
  );
}

export async function loadState(path: string): Promise<AvailabilityState> {
  try {
    const content = await readFile(path, "utf8");
    const value: unknown = JSON.parse(content);
    return parseState(value);
  } catch (error) {
    if (isFileNotFound(error)) {
      return EMPTY_STATE;
    }
    throw error;
  }
}

export function createState(
  statuses: readonly AvailabilityStatus[],
  updatedAt: Date,
): AvailabilityState {
  const values: Record<string, boolean> = {};
  for (const status of statuses) {
    values[availabilityKey(status)] = status.available;
  }
  return { version: 1, updatedAt: updatedAt.toISOString(), statuses: values };
}

export function statesHaveSameStatuses(
  first: AvailabilityState,
  second: AvailabilityState,
): boolean {
  const firstEntries = Object.entries(first.statuses);
  const secondEntries = Object.entries(second.statuses);
  return (
    firstEntries.length === secondEntries.length &&
    firstEntries.every(([key, value]) => second.statuses[key] === value)
  );
}

export async function saveState(
  path: string,
  state: AvailabilityState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
