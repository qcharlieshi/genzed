# Genzed Modernization — Design

**Date:** 2026-05-25
**Status:** Approved (sections 1–3)
**Author:** Charlie Shi

## Context

Genzed is a 2017 capstone project — a top-down multiplayer battle arena built on Phaser 2 + React 15 + Redux 3 + Webpack 2 + Babel 6 (client) and Express 4 + socket.io 1.7 (server), deployed to Heroku. The repo (`~/dev/genzed`) is currently unrunnable on modern Node without significant patching, and the client-authoritative netcode (clients send positions, server broadcasts) is cheatable.

Goals for modernization, as agreed during brainstorming:

- Treat it as a **living project** — invest in a foundation that supports future iteration, not a one-off "make it run" patch.
- **Rewrite the game on Phaser 3 + TypeScript** rather than keep Phaser 2 CE.
- **Authoritative server** using Colyseus (server owns the simulation).
- **Preserve gameplay 1:1** — same sprites, weapons, zombies, scoring as the original. Tuning constants are ported, not redesigned.
- **Modern React lobby** (React 18, no Redux) driven by Colyseus room state.
- **Host on Fly.io**, single deploy.

The original 12 MB of assets (sprites, sounds, Tiled maps, fonts) carry over verbatim — Phaser 3 reads the same image/atlas/Tiled formats. Gameplay rules are recovered by reading the existing `client/src/gameStates/*`, `client/src/prefabs/*`, and `server/reducers/*` files during planning.

## Non-goals (v1)

- Persistent leaderboards, accounts, or any database
- Spectator mode
- Mobile/touch controls
- Anti-cheat beyond server authority
- Audio/UX polish beyond what original assets provide
- Multiple concurrent rooms beyond what Colyseus gives for free
- Backward compatibility with the existing wire protocol — this is a clean rewrite

## High-level architecture

Monorepo, single deploy. The Colyseus server is also the static file server for the built client bundle. One Fly app, one `fly deploy`, no CORS, one origin in dev and prod.

```
[Browser] --HTTPS/WSS--> [Fly proxy] --HTTP/WS--> [Node 20 container]
                                                    ├── Express (static client/dist)
                                                    └── Colyseus (ArenaRoom, schema sync)
```

## Repo structure

```
genzed/
  package.json              # pnpm workspace root
  pnpm-workspace.yaml
  fly.toml
  Dockerfile
  .tool-versions            # node 20 via mise
  client/
    index.html
    src/
      main.tsx              # React mount
      lobby/                # React 18 lobby screens
      game/
        scenes/             # Phaser 3 Scenes (ex-gameStates)
        prefabs/            # Phaser 3 GameObjects (ex-prefabs)
        net/                # Colyseus client + interpolation/prediction
      shared/               # re-exports from ../../shared
    public/assets/          # sprites, sounds, maps (copied from old client/assets)
    vite.config.ts
  server/
    src/
      index.ts              # Express + Colyseus + static + /healthz
      rooms/
        ArenaRoom.ts        # room w/ fixed tick loop
      schema/
        ArenaState.ts       # @colyseus/schema (Player, Bullet, Zombie, Pickup...)
      sim/                  # collisions, spawns, damage, AI (server-authoritative)
      shared/               # re-exports from ../../shared
    tsconfig.json
  shared/
    src/
      messages.ts           # client->server input message types
      tuning.ts             # speeds, damage, health, spawn rates (ported from original)
      constants.ts          # tick rate, map size, room name
  docs/
    superpowers/specs/      # this file
```

## Stack

| Layer | Tech | Replaces |
| --- | --- | --- |
| Game engine | Phaser 3.80 | Phaser 2 |
| Client framework | React 18 | React 15 |
| Client build | Vite 5 | Webpack 2 + Babel 6 |
| Language | TypeScript 5 | JS + babel-preset-es2015 |
| Multiplayer | Colyseus 0.15 | socket.io 1.7 |
| Server | Node 20, Express 4, TypeScript | Node ?, Express 4, JS |
| Tooling | pnpm, ESLint, Prettier, Vitest, Playwright | npm/yarn, mocha+chai+enzyme |
| Deploy | Fly.io + Docker | Heroku |

Explicitly **dropped:** Redux, react-router, react-redux, redux-thunk, redux-logger, redux-devtools-extension, Webpack 2, Babel 6, node-sass, lodash, ramda, bootstrap-alpha, axios, socket.io.

## Netcode

### Tick & sync rates

- **Server simulation tick:** 20 Hz (50 ms fixed step).
- **State broadcast:** 20 Hz, riding Colyseus' built-in schema diff/patch wire format.
- **Client input rate:** up to ~60/s (capped), batched per frame.

### Server authority

The server owns: positions, velocities, health, bullet trajectories and lifetimes, zombie AI and spawns, pickup placement and consumption, scoring, win/lose. Clients never send positions — only inputs.

### Client input

Inputs are compact monotonic-sequenced messages:

```ts
type InputMessage = {
  seq: number;        // monotonic per-client
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  aim: number;        // radians
  shoot: boolean;
};
```

Server applies inputs in order during its tick.

### Client rendering

- **Remote players & zombies:** rendered with a **100 ms interpolation buffer** (Colyseus pattern — buffer two state snapshots, interpolate between them).
- **Local player:** client-side prediction. Apply inputs locally immediately; reconcile against authoritative state when it arrives for that `seq`. Snap on drift above a threshold.
- **Bullets:** server-authoritative spawn + path. Client may render a local muzzle flash immediately on input press for feel — the actual bullet position comes from server state.

### Room lifecycle

1. Client connects to `/colyseus`, joins `ArenaRoom` via `joinOrCreate("arena", { name })`.
2. **Lobby phase:** room state shows player list and ready states.
3. When all connected players are ready **and** there are ≥2 players (preserving the original's minimum), server transitions to **playing**. Server picks spawn positions.
4. **Playing phase:** server tick runs. Players take damage, zombies spawn, scores accrue.
5. **End phase:** triggered by the original's win condition (to be recovered from `server/reducers/*.js` during planning — likely last-player-standing). Final scores broadcast.
6. Room returns to lobby or closes per Colyseus defaults.

## Lobby UI

Single SPA at `/`. Three views, switched by local React state (no react-router):

1. **NameEntry** — enter a display name.
2. **Lobby** — show connected players + ready states, "ready up" button. Driven directly by Colyseus room state via a `useColyseusRoom()` hook that subscribes to schema changes.
3. **InGame** — Phaser game mounts into a `<div ref>`. The same Colyseus `room` instance is passed into the Phaser scene constructor. **One connection** for lobby and game.

Styling: Tailwind CSS. (Plain CSS modules is an acceptable alternative; decided during implementation.) No Bootstrap.

## Build

- **Client:** `vite build` → `client/dist/` with hashed asset URLs.
- **Server:** `tsc` → `server/dist/`.
- **Dockerfile (multi-stage):**
  1. `node:20-alpine` builder: install workspace deps with pnpm, build client and server.
  2. `node:20-alpine` runtime: copy `server/dist/`, `client/dist/`, and pruned `node_modules/`. `CMD ["node", "server/dist/index.js"]`.
- Server mounts `client/dist` as static + SPA catch-all on `/`. Colyseus mounts at `/colyseus`. Matchmaker exposed at `/matchmake`. **One port, one process, one container.** Fly's proxy terminates TLS and forwards WebSocket upgrades on the same port.

## Local development

- `pnpm dev` runs Vite (5173) and the Colyseus server (2567) concurrently.
- Vite proxies `/colyseus` and `/matchmake` to `:2567` so the client uses one origin in dev too.
- `.tool-versions` pins Node 20 (mise).

## Deploy

- Fly.io. Single VM, `shared-cpu-1x` / 256 MB to start.
- `fly.toml` checked in.
- Health check: HTTP `GET /healthz` → `200`.
- **No database.** Room state is in-memory. When a game ends, state drops. Fine for v1.

## CI

Single GitHub Actions workflow:

1. Install (pnpm, with cache).
2. Lint (ESLint).
3. Typecheck (`tsc --noEmit` in client and server).
4. Build (client + server).
5. Server tests (Vitest).
6. If branch is `main` and previous steps pass: `flyctl deploy`.

`FLY_API_TOKEN` stored as a repo secret.

## Testing strategy

- **Server sim:** Vitest unit tests for damage calculations, collision resolution, spawn logic, win condition.
- **Schema:** snapshot tests for the wire schema to catch accidental breakage.
- **Smoke:** one Playwright test — open two browser contexts, both join, ready up, game starts, both see each other move. Run in CI on PRs.
- **Manual:** the original game is the reference. Side-by-side play sessions during the gameplay-port phase.

## Open questions (resolved during planning, not now)

- Exact win condition from original (`server/reducers/engine.js` and `players.js`).
- Exact damage, health, weapon, and spawn numbers (port into `shared/tuning.ts`).
- Exact map list and Tiled JSON compatibility with Phaser 3's tilemap loader (likely fine, Tiled JSON format is stable).
- Whether Tailwind or plain CSS modules for the lobby (cosmetic).

## Staged delivery

Although this is one design, implementation should be staged so progress is visible and reversible:

1. **Foundation:** monorepo, pnpm workspace, Vite client shell, Colyseus server shell, Docker, Fly deploy, CI. Hello-world game scene + empty lobby. **Deployable.**
2. **Lobby + room lifecycle:** name entry, ready states, transitions, 2-player minimum.
3. **Gameplay port — movement & rendering:** Phaser 3 scene loads Tiled map, server-authoritative player movement with prediction & interpolation.
4. **Gameplay port — combat:** weapons, bullets, zombies, damage, pickups, scoring.
5. **Polish & playtest:** tune feel, fix prediction snap, side-by-side parity with original.

Each stage gets its own implementation plan via `writing-plans`.
