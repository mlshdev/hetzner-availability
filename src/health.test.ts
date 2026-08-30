import { describe, expect, test } from "bun:test";

import { assertHealthy, parseHealthState, type HealthState } from "./health.ts";

const NOW = new Date("2026-08-30T12:00:00Z");
const HEALTHY_STATE: HealthState = {
  version: 1,
  updatedAt: NOW.toISOString(),
  awsSes: {
    status: "ok",
    checkedAt: NOW.toISOString(),
    message: "SES credentials are valid",
  },
  hetznerApi: {
    status: "ok",
    checkedAt: NOW.toISOString(),
    message: "Hetzner API token is valid",
  },
  availabilityCheck: {
    status: "ok",
    checkedAt: NOW.toISOString(),
    message: "Checked four pairs",
  },
};

describe("container health state", () => {
  test("accepts fresh successful dependency checks", () => {
    expect(() =>
      assertHealthy(HEALTHY_STATE, 120_000, NOW.getTime()),
    ).not.toThrow();
    expect(parseHealthState(HEALTHY_STATE)).toEqual(HEALTHY_STATE);
  });

  test("fails when AWS SES validation failed", () => {
    const state: HealthState = {
      ...HEALTHY_STATE,
      awsSes: { ...HEALTHY_STATE.awsSes, status: "error" },
    };

    expect(() => assertHealthy(state, 120_000, NOW.getTime())).toThrow(
      "AWS SES health is error",
    );
  });

  test("fails when the Hetzner API token validation failed", () => {
    const state: HealthState = {
      ...HEALTHY_STATE,
      hetznerApi: { ...HEALTHY_STATE.hetznerApi, status: "error" },
    };

    expect(() => assertHealthy(state, 120_000, NOW.getTime())).toThrow(
      "Hetzner API health is error",
    );
  });

  test("fails when the last health update is stale", () => {
    expect(() =>
      assertHealthy(HEALTHY_STATE, 60_000, NOW.getTime() + 61_000),
    ).toThrow("Monitor health state is missing or stale");
  });
});
