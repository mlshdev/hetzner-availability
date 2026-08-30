import { describe, expect, test } from "bun:test";

import { parseLocationName, parseServerTypeName } from "./domain.ts";
import { parseServerTypeResponse } from "./hetzner.ts";

describe("parseServerTypeResponse", () => {
  test("extracts availability for both German locations", () => {
    const statuses = parseServerTypeResponse(
      {
        server_types: [
          {
            name: "cax21",
            locations: [
              { name: "fsn1", available: true },
              { name: "nbg1", available: false },
              { name: "hel1", available: true },
            ],
          },
        ],
      },
      parseServerTypeName("cax21"),
      [parseLocationName("fsn"), parseLocationName("nbg")],
    );

    expect(statuses).toEqual([
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
    ]);
  });

  test("fails closed when a requested location is absent", () => {
    expect(() =>
      parseServerTypeResponse(
        {
          server_types: [
            {
              name: "cax31",
              locations: [{ name: "fsn1", available: true }],
            },
          ],
        },
        parseServerTypeName("cax31"),
        [parseLocationName("fsn"), parseLocationName("nbg")],
      ),
    ).toThrow("Server type CAX31 is not offered in nbg1");
  });
});
