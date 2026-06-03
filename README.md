# Genzed

Multiplayer top-down battle arena. Modernized 2026 rewrite of a 2017 capstone project (Phaser 2 + socket.io). Original code preserved under `legacy/`.

**Live:** https://genzed.fly.dev

## Stack

- **Client:** Phaser 3, React 18, Vite, TypeScript
- **Server:** Node 20, Colyseus, Express, TypeScript
- **Deploy:** Fly.io (single container, server-authoritative)

## Development

Requires Node 20 and pnpm 9 (use `mise` to manage via `.tool-versions`).

```bash
pnpm install
pnpm dev          # client on :5173, server on :2567
pnpm test         # all packages
pnpm typecheck
pnpm lint
pnpm build        # production bundle
pnpm test:e2e     # Playwright smoke
```

After `pnpm build`, you can run the production server locally:

```bash
PORT=8080 node server/dist/index.js
```

and open `http://localhost:8080`.

## Deploy

`master` pushes auto-deploy to Fly.io via GitHub Actions (requires `FLY_API_TOKEN` repo secret). For manual deploy:

```bash
fly deploy
```

App runs as a single shared-cpu-1x machine in `sjc`. The Colyseus server also serves the built client bundle on the same port — TLS terminates at Fly's proxy.

## Project structure

- `client/` — Phaser 3 + React 18 + Vite
- `server/` — Colyseus + Express on Node 20
- `shared/` — types and constants used by both
- `legacy/` — original 2017 code (read-only reference)
- `docs/PROGRESS.md` — living progress tracker
- `docs/superpowers/specs/` — design docs
- `docs/superpowers/plans/` — implementation plans
- `CLAUDE.md` — guidance for Claude Code sessions
