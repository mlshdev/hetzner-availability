declare const serverTypeNameBrand: unique symbol;

export type ServerTypeName = string & {
  readonly [serverTypeNameBrand]: true;
};

export const HETZNER_LOCATIONS = [
  {
    apiName: "fsn1",
    aliases: ["fsn", "fsn1"],
    displayName: "FSN",
    city: "Falkenstein",
    country: "Germany",
  },
  {
    apiName: "nbg1",
    aliases: ["nbg", "nbg1"],
    displayName: "NBG",
    city: "Nuremberg",
    country: "Germany",
  },
  {
    apiName: "hel1",
    aliases: ["hel", "hel1"],
    displayName: "HEL",
    city: "Helsinki",
    country: "Finland",
  },
  {
    apiName: "ash",
    aliases: ["ash"],
    displayName: "ASH",
    city: "Ashburn, VA",
    country: "USA",
  },
  {
    apiName: "hil",
    aliases: ["hil"],
    displayName: "HIL",
    city: "Hillsboro, OR",
    country: "USA",
  },
  {
    apiName: "sin",
    aliases: ["sin"],
    displayName: "SIN",
    city: "Singapore",
    country: "Singapore",
  },
] as const;

export type LocationName = (typeof HETZNER_LOCATIONS)[number]["apiName"];
export type AvailabilityKey = `${ServerTypeName}:${LocationName}`;

export interface AvailabilityStatus {
  readonly serverType: ServerTypeName;
  readonly location: LocationName;
  readonly available: boolean;
}

export function parseServerTypeName(value: string): ServerTypeName {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) {
    throw new Error(`Invalid Hetzner server type: ${value}`);
  }
  return normalized as ServerTypeName;
}

export function parseLocationName(value: string): LocationName {
  const normalized = value.trim().toLowerCase();
  const location = HETZNER_LOCATIONS.find((candidate) =>
    candidate.aliases.some((alias) => alias === normalized),
  );
  if (location === undefined) {
    const acceptedValues = HETZNER_LOCATIONS.flatMap(
      (candidate) => candidate.aliases,
    ).join(", ");
    throw new Error(
      `Invalid Hetzner location: ${value}. Accepted values: ${acceptedValues}`,
    );
  }
  return location.apiName;
}

export function availabilityKey(
  status: Pick<AvailabilityStatus, "serverType" | "location">,
): AvailabilityKey {
  return `${status.serverType}:${status.location}`;
}

export function formatAvailability(status: AvailabilityStatus): string {
  const location = HETZNER_LOCATIONS.find(
    (candidate) => candidate.apiName === status.location,
  );
  if (location === undefined) {
    throw new Error(`Unknown normalized Hetzner location: ${status.location}`);
  }
  return `${status.serverType.toUpperCase()} in ${location.displayName} (${status.location})`;
}
