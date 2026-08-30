import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseServerTypeName, type AvailabilityStatus } from "./domain.ts";
import { createState, loadState, saveState } from "./state.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("availability state", () => {
  test("survives an atomic save and load round trip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hetzner-monitor-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const statuses: readonly AvailabilityStatus[] = [
      {
        serverType: parseServerTypeName("cax21"),
        location: "fsn1",
        available: true,
      },
      {
        serverType: parseServerTypeName("cax21"),
        location: "nbg1",
        available: false,
      },
      {
        serverType: parseServerTypeName("cax31"),
        location: "fsn1",
        available: false,
      },
      {
        serverType: parseServerTypeName("cax31"),
        location: "nbg1",
        available: true,
      },
    ];
    const state = createState(statuses, new Date("2026-08-30T12:00:00Z"));

    await saveState(path, state);

    expect(await loadState(path)).toEqual(state);
  });
});
