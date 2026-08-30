import { describe, expect, test } from "bun:test";

import { parseServerTypeName, type AvailabilityStatus } from "./domain.ts";
import { findNewlyAvailable } from "./monitor.ts";
import { createState, EMPTY_STATE } from "./state.ts";

const STATUSES: readonly AvailabilityStatus[] = [
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
    available: false,
  },
];

describe("findNewlyAvailable", () => {
  test("alerts when any one server and location pair is available", () => {
    expect(findNewlyAvailable(EMPTY_STATE, STATUSES)).toEqual([STATUSES[0]!]);
  });

  test("does not repeat an alert while the pair remains available", () => {
    const previous = createState(STATUSES, new Date("2026-08-30T00:00:00Z"));

    expect(findNewlyAvailable(previous, STATUSES)).toEqual([]);
  });

  test("alerts for a different pair that becomes available later", () => {
    const previous = createState(STATUSES, new Date("2026-08-30T00:00:00Z"));
    const current: readonly AvailabilityStatus[] = [
      ...STATUSES.slice(0, 3),
      {
        serverType: parseServerTypeName("cax31"),
        location: "nbg1",
        available: true,
      },
    ];

    expect(findNewlyAvailable(previous, current)).toEqual([current[3]!]);
  });
});
