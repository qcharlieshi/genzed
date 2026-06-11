# Genzed — Claude Code Guidance

Personal project (not a LILT repo). **Prototype tier** — favor iteration speed and simplicity. Happy-path tests only, error handling only on critical paths, no docs unless asked.

## What this is

A 2026 rewrite of a 2017 capstone multiplayer game (top-down battle arena). Originally Phaser 2 + React 15 + socket.io. Now Phaser 3 + React 18 + Colyseus, on a pnpm monorepo deployed to Fly.io. Original code archived under `legacy/` as a read-only reference for porting gameplay rules.

Live: https://genzed.fly.dev

## Where things live

- `client/` — Phaser 3 + React 18 + Vite + TypeScript
- `server/` — Node 20 + Colyseus + Express + TypeScript
- `shared/` — types and constants for the wire (tick rate, room name, message types as they get added)
- `legacy/` — 2017 reference code. **Read it for gameplay rules** (damage, weapons, spawn logic) — port constants into `shared/tuning.ts` rather than guessing
- `docs/PROGRESS.md` — living tracker
- `docs/superpowers/specs/` — design docs (one per stage)
- `docs/superpowers/plans/` — implementation plans (one per stage)
- `docs/stage1-evidence/` — verification screenshots

## Staged delivery

The project is decomposed into 5 stages. Each gets its own spec → plan → build cycle.

1. ✅ **Foundation** — monorepo, server shell, client shell, Docker, Fly, CI, deployable hello-world (live now)
2. ✅ **Lobby + room lifecycle** — name entry, host-starts, phase FSM, 10s reconnection grace, placeholder arena scene
3. 🟡 **Movement + rendering** — Tiled map load, server-authoritative movement, client prediction + interpolation (In PR — branch `stage-3-movement`)
4. ⬜ **Combat** — weapons, bullets, zombies, damage, pickups, scoring (port tuning from `legacy/`)
5. ⬜ **Polish + playtest** — tune feel, fix prediction snap, side-by-side parity with the original

Don't skip ahead. Each stage produces a deployable, testable artifact.

## Architectural invariants

These are load-bearing. Don't violate without surfacing the change.

- **Server is authoritative.** Clients send inputs, never positions. Colyseus owns state via schemas; rendering interpolates server snapshots; the local player uses input prediction + reconciliation. The original code was client-authoritative — do not regress to that.
- **Single container, single port.** The Colyseus server also serves the built client bundle. No CORS, no second service. Vite proxies `/colyseus` and `/matchmake` to the server in dev so the client always uses one origin.
- **Single VM on Fly.** Colyseus seat reservations live in-process — matchmaking POST and the WebSocket upgrade must land on the same machine. `fly scale count 1` is intentional. If multi-machine HA becomes a goal, that's a redesign (Redis-backed presence), not a config tweak.
- **No database.** Room state is in-memory; games end → state drops. Persistence is explicitly out of scope until a stage adds it.
- **`@genzed/shared` exports `dist`, not source.** The compiled Node server can't load `.ts`. Shared has a `prepare: tsc` script so `pnpm install` builds it. If you add new shared modules, they must export through `shared/dist/`.

## Common commands

```bash
pnpm dev          # client :5173 (Vite proxy) + server :2567
pnpm build        # all packages
pnpm typecheck    # all packages
pnpm test         # vitest in server
pnpm test:e2e     # playwright smoke
pnpm lint         # eslint flat config at root
PORT=8080 node server/dist/index.js   # run the production bundle locally
docker build -t genzed:local .        # mirror the prod container
fly deploy                            # deploy to fly.io
fly logs                              # live logs from genzed.fly.dev
```

## Versions

- Node 20 (`.tool-versions`, used by mise)
- pnpm 9.12.0 (`packageManager` in root `package.json`, activated via corepack)
- TypeScript 5.5.4
- Phaser 3.80.1
- React 18.3.1
- Vite 5.4.2
- Colyseus 0.15.x (server `@0.15.57`, client `colyseus.js@0.15.26`, schema `@2.0.37`)

If a Colyseus minor changes, align server + client + schema together — wire-protocol drift is the worst class of bug to debug here.

## Workflow

For non-trivial work (anything beyond a typo fix):

1. **Brainstorm** with `superpowers:brainstorming` → write a stage spec to `docs/superpowers/specs/`.
2. **Plan** with `superpowers:writing-plans` → write a step-by-step plan to `docs/superpowers/plans/`.
3. **Execute** with `superpowers:subagent-driven-development` (or executing-plans for inline).
4. **Verify** end-to-end before claiming done — Vitest passes, type/lint pass, `pnpm dev` and the Docker build both produce a working canvas connection. Screenshot to `docs/stageN-evidence/`.

The brainstorming/plan files are the source of truth for what a stage should produce. If implementation drifts from the plan, update the plan with a note, don't silently diverge.

## Gameplay porting

When recovering rules from `legacy/`:

- Read `legacy/server/reducers/players.js`, `legacy/server/reducers/zombies.js`, `legacy/server/engine/updateClientLoop.js` for server-side rules (health, damage, scoring, spawn cadence).
- Read `legacy/client/src/gameStates/*` and `legacy/client/src/prefabs/*` for sprite + animation + collision data and bullet/weapon constants.
- Port concrete numbers into `shared/src/tuning.ts` (create when needed). Server and client both read from there — never duplicate magic numbers.
- Assets (`legacy/client/assets/`) carry over verbatim. Move into `client/public/assets/` as they're needed.

## Known sharp edges

- Roll/dodge, mouse aim, combat all deferred to Stage 4.
- E2E runs with `workers: 1` — parallel spec files would share the single lobby room.
- Real `end_game` trigger isn't wired — only the dev message handler exists; Stage 4 wires it to win conditions.
- `fly.toml` has `min_machines_running = 0` + `auto_stop_machines = "stop"`. Bump `min_machines_running = 1` once there's real session state — currently fine because there isn't.
- Vite output has one ~1.7 MB JS chunk (Phaser is heavy). Don't worry about it for now; code-split when stage 3+ pulls in more.
- `tsc -b --noEmit` requires TS 5.6+. We're on 5.5.4 so `typecheck` is `tsc --noEmit` per-package. Bump TS when there's a reason.
- Client/server Colyseus version skew (`colyseus.js@0.15.26` vs server `@0.15.57`) — both resolve `@colyseus/schema@2.0.37` today, but align before further wire-protocol work.

## When in doubt

- Read `docs/PROGRESS.md` for current status, including operational notes.
- Read the latest stage spec before touching that stage's code.
- Don't gold-plate. Prototype tier — three similar lines beat a premature abstraction.
