import type { Logger } from "./logger.ts";
import { errorFields } from "./logger.ts";
import type {
  AvailabilityStatus,
  LocationName,
  ServerTypeName,
} from "./domain.ts";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

interface ServerTypeLocationPayload {
  readonly name: string;
  readonly available: boolean;
}

export class HetznerApiError extends Error {
  override readonly name = "HetznerApiError";
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocation(value: unknown): ServerTypeLocationPayload {
  if (
    !isRecord(value) ||
    typeof value["name"] !== "string" ||
    typeof value["available"] !== "boolean"
  ) {
    throw new HetznerApiError(
      "Hetzner API returned an invalid server type location",
    );
  }
  return { name: value["name"], available: value["available"] };
}

export function parseServerTypeResponse(
  value: unknown,
  expectedServerType: ServerTypeName,
  requestedLocations: readonly LocationName[],
): readonly AvailabilityStatus[] {
  if (!isRecord(value) || !Array.isArray(value["server_types"])) {
    throw new HetznerApiError(
      "Hetzner API returned an invalid server type response",
    );
  }

  const matchingTypes = value["server_types"].filter(
    (serverType): serverType is Readonly<Record<string, unknown>> =>
      isRecord(serverType) && serverType["name"] === expectedServerType,
  );
  if (matchingTypes.length !== 1) {
    throw new HetznerApiError(
      `Hetzner API did not return exactly one ${expectedServerType} server type. Check HETZNER_SERVER_TYPES.`,
    );
  }

  const matchingType = matchingTypes[0];
  if (matchingType === undefined || !Array.isArray(matchingType["locations"])) {
    throw new HetznerApiError(
      `Hetzner API returned invalid locations for ${expectedServerType}`,
    );
  }

  const locations = matchingType["locations"].map(parseLocation);
  return requestedLocations.map((location) => {
    const matches = locations.filter(
      (candidate) => candidate.name === location,
    );
    if (matches.length !== 1 || matches[0] === undefined) {
      throw new HetznerApiError(
        `Server type ${expectedServerType.toUpperCase()} is not offered in ${location}. Check the compatibility table in README.md.`,
      );
    }
    return {
      serverType: expectedServerType,
      location,
      available: matches[0].available,
    };
  });
}

function parseLocationValidationResponse(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value["locations"])) {
    throw new HetznerApiError(
      "Hetzner API returned an invalid locations response",
    );
  }
  const names = value["locations"].map((location) => {
    if (!isRecord(location) || typeof location["name"] !== "string") {
      throw new HetznerApiError(
        "Hetzner API returned an invalid location during token validation",
      );
    }
    return location["name"];
  });
  if (names.length === 0) {
    throw new HetznerApiError(
      "Hetzner API token validation returned no accessible locations",
    );
  }
  return names;
}

export class HetznerClient {
  readonly #apiToken: string;
  readonly #timeoutMs: number;
  readonly #logger: Logger;
  readonly #fetcher: Fetcher;

  constructor(
    apiToken: string,
    timeoutMs: number,
    logger: Logger,
    fetcher: Fetcher = fetch,
  ) {
    this.#apiToken = apiToken;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
    this.#fetcher = fetcher;
    this.#logger.debug("Hetzner API client configured", {
      api_base_url: "https://api.hetzner.cloud/v1",
      request_timeout_ms: timeoutMs,
      credentials_present: true,
    });
  }

  async validateToken(): Promise<void> {
    this.#logger.info("Hetzner API token validation started", {
      validation_operation: "GET /locations",
    });
    const response = await this.#requestJson(
      "/locations?per_page=50",
      "validate_token",
    );
    const locations = parseLocationValidationResponse(response);
    this.#logger.info("Hetzner API token is working", {
      validation_operation: "GET /locations",
      accessible_location_count: locations.length,
      accessible_locations: locations,
    });
  }

  async fetchServerTypeAvailability(
    serverType: ServerTypeName,
    locations: readonly LocationName[],
  ): Promise<readonly AvailabilityStatus[]> {
    this.#logger.info("Hetzner server availability request started", {
      server_type: serverType.toUpperCase(),
      requested_locations: locations,
    });
    const query = new URLSearchParams({ name: serverType });
    const response = await this.#requestJson(
      `/server_types?${query}`,
      `availability_${serverType}`,
    );
    const statuses = parseServerTypeResponse(response, serverType, locations);
    this.#logger.info("Hetzner server availability response validated", {
      server_type: serverType.toUpperCase(),
      statuses: statuses.map((status) => ({
        location: status.location,
        available: status.available,
      })),
    });
    return statuses;
  }

  async #requestJson(path: string, operation: string): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const url = `https://api.hetzner.cloud/v1${path}`;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    this.#logger.debug("Hetzner API HTTP request prepared", {
      operation,
      request_id: requestId,
      method: "GET",
      url,
      authorization_header_present: true,
    });

    let response: Response;
    try {
      response = await this.#fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiToken}`,
          "User-Agent": "hetzner-availability-monitor/1.0.0",
        },
        signal: controller.signal,
      });
    } catch (error) {
      this.#logger.error("Hetzner API HTTP request failed before a response", {
        operation,
        request_id: requestId,
        duration_ms: Math.round(performance.now() - startedAt),
        ...errorFields(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const responseFields = {
      operation,
      request_id: requestId,
      http_status_code: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
      rate_limit: response.headers.get("ratelimit-limit"),
      rate_limit_remaining: response.headers.get("ratelimit-remaining"),
      rate_limit_reset: response.headers.get("ratelimit-reset"),
    } as const;
    this.#logger.debug("Hetzner API HTTP response received", responseFields);

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500).trim();
      const error = new HetznerApiError(
        `Hetzner API request failed with HTTP ${response.status}: ${responseBody}`,
        response.status,
      );
      this.#logger.error("Hetzner API rejected the request", {
        ...responseFields,
        response_body: responseBody,
        ...errorFields(error),
      });
      throw error;
    }

    try {
      const responseBody: unknown = await response.json();
      this.#logger.debug("Hetzner API JSON response parsed", responseFields);
      return responseBody;
    } catch (error) {
      this.#logger.error("Hetzner API response was not valid JSON", {
        ...responseFields,
        ...errorFields(error),
      });
      throw error;
    }
  }
}
