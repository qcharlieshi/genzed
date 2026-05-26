# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── deps: install all workspace deps (frozen) ──────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

# ── build: compile all packages ─────────────────────────────────────────────
FROM deps AS build
COPY shared shared
COPY client client
COPY server server
RUN pnpm build

# Produce a pruned production-only server deploy tree.
# pnpm deploy respects .gitignore by default, so dist/ may be excluded.
# We copy dist/ and shared/dist/ explicitly after deploy to be safe.
RUN pnpm --filter @genzed/server deploy --prod /prod/server

# pnpm deploy may NOT copy workspace-package built dist/ (shared) because:
#   1. @genzed/shared is a workspace dep — deploy copies package.json + node_modules only
#   2. @genzed/shared's exports resolve to dist/index.js (required at runtime)
# Copy shared/dist/ into the deployed tree explicitly.
RUN cp -r shared/dist /prod/server/node_modules/@genzed/shared/dist

# pnpm deploy may skip server/dist/ if .gitignore excludes "dist".
# Use mkdir + cp of contents to handle the case where deploy already created dist/.
RUN mkdir -p /prod/server/dist && cp -r server/dist/. /prod/server/dist/

# ── runtime: minimal production image ───────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080

# Server deploy lands at /app; its compiled entry is /app/dist/index.js.
# __dirname of dist/index.js = /app/dist
# path.resolve("/app/dist", "../../client/dist") = /client/dist
# So we place the client bundle at /client/dist.
WORKDIR /app
COPY --from=build /prod/server ./
COPY --from=build /app/client/dist /client/dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
