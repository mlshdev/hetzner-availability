FROM docker.io/oven/bun:1.4.0 AS development-dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY .prettierignore tsconfig.json ./
COPY src ./src
RUN bun run format:check && bun run typecheck && bun test

FROM docker.io/oven/bun:1.4.0 AS production-dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM docker.io/oven/bun:1.4.0 AS runtime

ARG APP_VERSION="1.0.0"
ARG APP_REVISION="unknown"
ARG SOURCE_URL="https://github.com/mlshdev/hetzner-availability"

LABEL org.opencontainers.image.title="Hetzner Availability Monitor" \
      org.opencontainers.image.description="Monitors Hetzner Cloud capacity and sends AWS SES alerts" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_REVISION}" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.licenses="MIT"

ENV APP_VERSION="${APP_VERSION}" \
    APP_REVISION="${APP_REVISION}" \
    NODE_ENV="production"

WORKDIR /app

COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json ./
COPY --from=development-dependencies --chown=bun:bun /app/src ./src

USER root:root
RUN mkdir -p /data && chown bun:bun /data

USER bun:bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["bun", "run", "src/healthcheck.ts"]

ENTRYPOINT ["bun", "run", "src/index.ts"]
