# Forgegent images — one Dockerfile, two targets (web / runner).
# docker build --target runtime-web / --target runtime-runner
FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/runner/package.json apps/runner/
COPY packages/shared/package.json packages/shared/
COPY packages/pi-adapter/package.json packages/pi-adapter/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json vitest.config.ts eslint.config.mjs ./
COPY apps apps
COPY packages packages
RUN pnpm -r build

FROM base AS runtime-web
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@forgegent/web", "start"]

FROM base AS runtime-runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@forgegent/runner", "start"]
