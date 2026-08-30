import { describe, expect, test } from "bun:test";

import { readConfig } from "./config.ts";

const REQUIRED_ENVIRONMENT = {
  HETZNER_API_TOKEN: "hetzner-token",
  HETZNER_SERVER_TYPES: "CAX21,CAX31",
  HETZNER_LOCATIONS: "fsn,nbg",
  AWS_ACCESS_KEY_ID: "aws-access-key",
  AWS_SECRET_ACCESS_KEY: "aws-secret-key",
  AWS_REGION: "eu-central-1",
  SES_FROM_EMAIL: "sender@example.com",
  SES_RECIPIENT_EMAIL: "receipient@example.com",
} as const;

describe("readConfig", () => {
  test("uses safe polling defaults", () => {
    const config = readConfig(REQUIRED_ENVIRONMENT);

    expect(config.pollIntervalMs).toBe(60_000);
    expect(config.requestTimeoutMs).toBe(15_000);
    expect(config.sesRecipientEmail).toBe("receipient@example.com");
    expect(config.serverTypes.map(String)).toEqual(["cax21", "cax31"]);
    expect(config.locations).toEqual(["fsn1", "nbg1"]);
    expect(config.logLevel).toBe("debug");
  });

  test("rejects an interval that would poll too aggressively", () => {
    expect(() =>
      readConfig({ ...REQUIRED_ENVIRONMENT, POLL_INTERVAL_SECONDS: "10" }),
    ).toThrow("POLL_INTERVAL_SECONDS must be an integer between 30 and 86400");
  });

  test("rejects missing credentials", () => {
    expect(() =>
      readConfig({ ...REQUIRED_ENVIRONMENT, HETZNER_API_TOKEN: "" }),
    ).toThrow("Missing required environment variable: HETZNER_API_TOKEN");
  });

  test("rejects unknown location aliases", () => {
    expect(() =>
      readConfig({ ...REQUIRED_ENVIRONMENT, HETZNER_LOCATIONS: "berlin" }),
    ).toThrow("Invalid Hetzner location: berlin");
  });
});
