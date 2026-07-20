FROM node:24.18.0-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install dependencies only
# pnpm-workspace.yaml carries onlyBuiltDependencies/allowBuilds; without it pnpm 11
# aborts install with ERR_PNPM_IGNORED_BUILDS for prisma/esbuild/sharp/etc.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Minimal dev stage — no install; pnpm runs at container startup via docker-compose.dev.yml
FROM base AS dev
WORKDIR /app

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG STAMPORAMA_VERSION=dev
ENV STAMPORAMA_VERSION=$STAMPORAMA_VERSION
RUN BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=stamporama-local-build-auth-secret \
    pnpm prisma:generate \
  && BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=stamporama-local-build-auth-secret \
    pnpm build

# Production runner — ships node_modules, not standalone output
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# node_modules is baked into this image; do not let pnpm's verify-deps-before-run
# check auto-run `pnpm install` when starting scripts. That install would fail with
# ERR_PNPM_IGNORED_BUILDS since the build-scripts allowlist lives in pnpm-workspace.yaml.
# Disable the check and ship the workspace file as a safety net.
ENV npm_config_verify_deps_before_run=false
ARG STAMPORAMA_VERSION=dev
ENV STAMPORAMA_VERSION=$STAMPORAMA_VERSION

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
# Maintenance scripts run in the container via `docker compose exec` (e.g. the fs->GCS photo
# migration, #138: `pnpm photos:migrate:gcs`). tsx is present because node_modules ships devDeps.
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["pnpm", "start"]
