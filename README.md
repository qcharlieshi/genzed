# Genzed

Multiplayer top-down battle arena. Modernized 2026 rewrite of a 2017 capstone project (Phaser 2 + socket.io). Original code preserved under `legacy/`.

## Stack

- **Client:** Phaser 3, React 18, Vite, TypeScript
- **Server:** Node 20, Colyseus, Express, TypeScript
- **Deploy:** Fly.io (single container)

## Development

Requires Node 20 and pnpm 9 (use `mise` to manage via `.tool-versions`).

```bash
pnpm install
pnpm dev          # client on :5173, server on :2567
pnpm test         # all packages
pnpm typecheck
pnpm build        # production bundle
```

After `pnpm build`, you can run the production server locally:

```bash
PORT=8080 node server/dist/index.js
```

and open `http://localhost:8080`.

## Deploy

`master` pushes auto-deploy to Fly.io via GitHub Actions. For manual deploy:

```bash
fly deploy
```

## Project structure

- `client/` — Phaser 3 + React 18 + Vite
- `server/` — Colyseus + Express on Node 20
- `shared/` — types and constants used by both
- `legacy/` — original 2017 code (read-only reference)
- `docs/superpowers/specs/` — design docs
- `docs/superpowers/plans/` — implementation plans
