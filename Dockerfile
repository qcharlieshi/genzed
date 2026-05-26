# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ── build: install deps and compile all packages ────────────────────────────
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

COPY shared shared
COPY client client
COPY server server

# Sequence shared first so its dist/ exists before client/server resolve it.
RUN pnpm --filter @genzed/shared run build
RUN pnpm --filter @genzed/server run build
RUN pnpm --filter @genzed/client run build

# Produce a pruned production-only server deploy tree.
RUN pnpm --filter @genzed/server deploy --prod /prod/server

# pnpm deploy carries package.json + node_modules but not the source dist/
# of workspace packages. Copy shared/dist explicitly so @genzed/shared
# resolves at runtime.
RUN cp -r shared/dist /prod/server/node_modules/@genzed/shared/dist

# Belt-and-suspenders: ensure server/dist landed in the deploy tree.
RUN mkdir -p /prod/server/dist && cp -r server/dist/. /prod/server/dist/

# ── runtime: minimal production image ───────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080

# Server entry is /app/dist/index.js. __dirname = /app/dist.
# path.resolve("/app/dist", "../../client/dist") = /client/dist
WORKDIR /app
COPY --from=build /prod/server ./
COPY --from=build /app/client/dist /client/dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
