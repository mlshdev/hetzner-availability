# Hetzner Availability Monitor

Continuously checks configured Hetzner Cloud server types and locations. When any individual server/location pair changes from unavailable to available, the monitor sends one plain-text email through AWS SES and includes the current status of every configured pair.

Availability state is persisted in a Docker volume. An unchanged available pair does not generate repeated alerts, but a different pair becoming available does. A pair also generates a new alert if it becomes unavailable and later becomes available again.

## Configuration

Set the empty values in `credentials.env`. A tracked `credentials.env.example` is included for new checkouts.

```dotenv
HETZNER_API_TOKEN=
HETZNER_SERVER_TYPES=CAX21,CAX31
HETZNER_LOCATIONS=fsn,nbg
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
AWS_REGION=eu-central-1
SES_FROM_EMAIL=
SES_RECIPIENT_EMAIL=receipient@example.com
POLL_INTERVAL_SECONDS=60
REQUEST_TIMEOUT_SECONDS=15
LOG_LEVEL=debug
```

| Variable                  | Required | Purpose                                                              |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `HETZNER_API_TOKEN`       | Yes      | Read-only Hetzner Cloud API token                                    |
| `HETZNER_SERVER_TYPES`    | Yes      | Comma-separated server type names; case-insensitive                  |
| `HETZNER_LOCATIONS`       | Yes      | Comma-separated API names or supported short aliases                 |
| `AWS_ACCESS_KEY_ID`       | Yes      | AWS access key allowed to call SES                                   |
| `AWS_SECRET_ACCESS_KEY`   | Yes      | AWS secret access key                                                |
| `AWS_SESSION_TOKEN`       | No       | Token for temporary AWS credentials                                  |
| `AWS_REGION`              | Yes      | Region containing the SES sending identity                           |
| `SES_FROM_EMAIL`          | Yes      | SES-verified sender address or address under a verified domain       |
| `SES_RECIPIENT_EMAIL`     | Yes      | Alert recipient; defaults to `receipient@example.com` in the example |
| `POLL_INTERVAL_SECONDS`   | No       | Poll interval from 30 to 86400 seconds; example uses 60              |
| `REQUEST_TIMEOUT_SECONDS` | No       | Per-request timeout from 1 to 120 seconds; example uses 15           |
| `LOG_LEVEL`               | No       | `debug`, `info`, `warning`, or `error`; example uses `debug`         |

Empty values, invalid intervals, unknown location aliases, and malformed server names cause an immediate startup error. Duplicate server types or locations are removed after normalization.

## Hetzner Locations

These are all six current Hetzner Cloud location API names. The short aliases are accepted only where shown.

| API name | Accepted values | City              | Country   | Network zone   |
| -------- | --------------- | ----------------- | --------- | -------------- |
| `fsn1`   | `fsn`, `fsn1`   | Falkenstein       | Germany   | `eu-central`   |
| `nbg1`   | `nbg`, `nbg1`   | Nuremberg         | Germany   | `eu-central`   |
| `hel1`   | `hel`, `hel1`   | Helsinki          | Finland   | `eu-central`   |
| `ash`    | `ash`           | Ashburn, Virginia | USA       | `us-east`      |
| `hil`    | `hil`           | Hillsboro, Oregon | USA       | `us-west`      |
| `sin`    | `sin`           | Singapore         | Singapore | `ap-southeast` |

For the original Germany-only requirement, use:

```dotenv
HETZNER_LOCATIONS=fsn,nbg
```

Source: [Hetzner Cloud locations](https://docs.hetzner.com/cloud/general/locations/).

## Hetzner Server Types

Current server types documented by Hetzner as of August 2026:

| Category                   | Architecture                | Server types                                         | Documented locations                        |
| -------------------------- | --------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Cost-Optimized shared      | x86                         | `CX23`, `CX33`, `CX43`, `CX53`                       | `fsn1`, `nbg1`, `hel1`                      |
| Cost-Optimized shared      | Arm64                       | `CAX11`, `CAX21`, `CAX31`, `CAX41`                   | `fsn1`, `nbg1`, `hel1`                      |
| Regular Performance shared | AMD x86, current generation | `CPX12`, `CPX22`, `CPX32`, `CPX42`, `CPX52`, `CPX62` | `fsn1`, `nbg1`, `hel1`, `sin`               |
| Regular Performance shared | AMD x86, US generation      | `CPX11`, `CPX21`, `CPX31`, `CPX41`, `CPX51`          | `ash`, `hil`                                |
| General Purpose dedicated  | AMD x86                     | `CCX13`, `CCX23`, `CCX33`, `CCX43`, `CCX53`, `CCX63` | `fsn1`, `nbg1`, `hel1`, `ash`, `hil`, `sin` |

Sources: [Cost-Optimized](https://www.hetzner.com/cloud/cost-optimized/), [Regular Performance](https://www.hetzner.com/cloud/regular-performance/), and [General Purpose](https://www.hetzner.com/cloud/general-purpose/).

Hetzner changes its catalog over time. The monitor accepts future syntactically valid server names, then asks the API to validate that each configured server type exists in every configured location. Unsupported combinations produce a detailed error, mark the container unhealthy, and do not create a false availability result.

## AWS SES Permissions

The monitor validates SES on every cycle with the SES v2 `GetAccount` operation before attempting an alert. The AWS principal therefore needs `ses:GetAccount` and `ses:SendEmail`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:GetAccount", "ses:SendEmail"],
      "Resource": "*"
    }
  ]
}
```

For tighter permissions, scope `ses:SendEmail` to the verified identity ARN while retaining the account-level read permission required by `GetAccount`.

The configured sender must be verified in `AWS_REGION`. If the SES account is in the sandbox, the recipient must also be verified in that region. Logs report whether sending is enabled, whether the account has production access, its enforcement status, and current quota without printing credentials.

## Run

Build and start the long-running monitor:

```sh
docker compose up --build --detach
```

Inspect the container name and health:

```sh
docker compose ps
docker inspect --format '{{json .State.Health}}' hetzner-informaer-monitor-1
```

Read or follow all structured stdout logs:

```sh
docker logs hetzner-informaer-monitor-1
docker logs --follow hetzner-informaer-monitor-1
```

Each cycle logs:

- Configuration and client initialization without credential values
- SES `GetAccount` request start, response metadata, credential validity, sending state, sandbox state, enforcement state, and quota
- Hetzner token-validation request, HTTP status, latency, rate-limit headers, and accessible locations
- Every server-type request and every configured location's availability
- `last_check_at`, complete status snapshot, available/unavailable counts, and cycle duration
- Alert decision, SES message submission, AWS request/message IDs, retries, and errors
- State persistence, next poll delay, and graceful shutdown

Stop the service without deleting persisted availability state:

```sh
docker compose down
```

## Healthcheck

The process atomically writes `/tmp/monitor-health.json`. Docker marks the container unhealthy when any of these conditions is true:

- AWS credentials cannot call `GetAccount`
- SES sending is disabled in the configured region
- The Hetzner API token validation request fails
- A configured server/location combination is invalid or its availability request fails
- The last successful health update is stale
- Availability state cannot be persisted

An unhealthy container continues running and retrying so `docker logs` remains available for diagnosis. Docker does not automatically restart a merely unhealthy container.

## Container Images and Versioning

GitHub Actions publishes multi-architecture `linux/amd64` and `linux/arm64` images to:

```text
ghcr.io/mlshdev/hetzner-availability
```

Every pushed commit receives immutable `sha-<short-sha>` and branch tags. Commits on `main` also update `latest`. Git tags using Semantic Versioning publish stable version aliases:

| Git tag  | Published image tags |
| -------- | -------------------- |
| `v1.2.3` | `1.2.3`, `1.2`, `1`  |

Use immutable SHA or full SemVer tags for production deployments. Use `latest` only when automatic upgrades are intentional. The image embeds its version and Git revision in OCI labels and every log line.

Create and publish a release version with:

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

## Development

The project pins Bun 1.4.0 and TypeScript 7.0.2. Run all checks with:

```sh
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun test
bun audit
docker compose config --quiet
docker compose build
```
