import { describe, expect, test } from "bun:test";

import { parseServerTypeName, type AvailabilityStatus } from "./domain.ts";
import { buildAvailabilityEmail } from "./notifier.ts";

describe("buildAvailabilityEmail", () => {
  test("reports the triggering pair and all current statuses", () => {
    const statuses: readonly AvailabilityStatus[] = [
      {
        serverType: parseServerTypeName("cax21"),
        location: "fsn1",
        available: false,
      },
      {
        serverType: parseServerTypeName("cax21"),
        location: "nbg1",
        available: true,
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
    const email = buildAvailabilityEmail(
      [statuses[1]!],
      statuses,
      new Date("2026-08-30T12:00:00Z"),
    );

    expect(email.subject).toBe("Hetzner VPS available: CAX21 in NBG (nbg1)");
    expect(email.body).toContain("CAX21 in NBG (nbg1): AVAILABLE");
    expect(email.body).toContain("CAX31 in FSN (fsn1): unavailable");
  });
});
