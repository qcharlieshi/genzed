# Genzed Modernization — Progress

Living tracker for the 2017 → 2026 rewrite. Updated as stages land.

- **Design spec:** [docs/superpowers/specs/2026-05-25-genzed-modernization-design.md](superpowers/specs/2026-05-25-genzed-modernization-design.md)
- **Stage 1 plan:** [docs/superpowers/plans/2026-05-25-stage1-foundation.md](superpowers/plans/2026-05-25-stage1-foundation.md)
- **Stage 2 spec:** [docs/superpowers/specs/2026-06-04-stage2-lobby-design.md](superpowers/specs/2026-06-04-stage2-lobby-design.md)
- **Stage 2 plan:** [docs/superpowers/plans/2026-06-04-stage2-lobby.md](superpowers/plans/2026-06-04-stage2-lobby.md)
- **Stage 3 spec:** [docs/superpowers/specs/2026-06-10-stage3-movement-design.md](superpowers/specs/2026-06-10-stage3-movement-design.md)
- **Stage 3 plan:** [docs/superpowers/plans/2026-06-10-stage3-movement.md](superpowers/plans/2026-06-10-stage3-movement.md)

## Direction (settled during brainstorming)

| Decision | Choice |
| --- | --- |
| Intent | Living project — invest in a foundation to keep building on |
| Engine | Migrate Phaser 2 → **Phaser 3 + TypeScript** |
| Netcode | **Authoritative server** via Colyseus (server owns the sim) |
| Faithfulness | Preserve original gameplay **1:1** (sprites, weapons, zombies, scoring) |
| Lobby | **React 18**, no Redux — driven by Colyseus room state |
| Hosting | **Fly.io**, single container, single deploy |
| Repo | **pnpm monorepo** (`shared` / `server` / `client`) |

## Staged delivery

| Stage | Scope | Status |
| --- | --- | --- |
| **1. Foundation** | Monorepo, server shell, client shell, Docker, Fly, CI, deployable hello-world | ✅ Shipped — live at https://genzed.fly.dev |
| **2. Lobby + room lifecycle** | Name entry, host-starts, phase FSM, 2-player minimum, 10s reconnection grace, placeholder arena | ✅ Shipped |
| **3. Movement + rendering** | Tiled map load, server-authoritative movement, client prediction + interpolation | 🟡 In PR — branch `stage-3-movement` |
| **4. Combat** | Weapons, bullets, zombies, damage, pickups, scoring (port tuning from `legacy/`) | ⬜ Not started |
| **5. Polish + playtest** | Tune feel, fix prediction snap, side-by-side parity with the original | ⬜ Not started |

Each stage gets its own spec → plan → build cycle.

## Stage 1 — what shipped

Branch `stage-1-foundation`, 20 commits, PR #1 against `master`.

**Stack swap:**

| Layer | Was (2017) | Now |
| --- | --- | --- |
| Engine | Phaser 2 | Phaser 3.80 |
| Client framework | React 15 + Redux 3 + react-router 3 | React 18 (no Redux) |
| Build | Webpack 2 + Babel 6 + node-sass | Vite 5 + TypeScript 5 |
| Multiplayer | socket.io 1.7 | Colyseus 0.15 |
| Server | Express 4 (JS) | Express 4 + Colyseus (TS, Node 20) |
| Tests | mocha + chai + enzyme | Vitest + Playwright |
| Deploy | Heroku | Fly.io (Docker) |

**Structure:** `shared/` (tick constants), `server/` (Express + Colyseus `ArenaRoom`, `/healthz`), `client/` (Vite + React + Phaser `HelloScene`). Original 2017 code archived under `legacy/`.

**Behavior:** a browser loads the React shell, a Phaser `HelloScene` mounts, connects to the Colyseus `ArenaRoom` over WebSocket, and renders `connected: <sessionId>`. Server is authoritative-ready (clients will send inputs, not positions).

**Single-container model:** multi-stage Dockerfile (241 MB) where the Colyseus server also serves the built client bundle on one port. Fly's proxy terminates TLS and forwards the WebSocket upgrade on the same port. No CORS, no second service.

## Verification (Stage 1)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean across all 3 packages |
| `pnpm lint` | ✅ clean |
| `pnpm test` | ✅ 2 server tests (healthz, ArenaRoom join) |
| `pnpm test:e2e` | ✅ Playwright smoke (canvas mounts, connects, no console errors) |
| `pnpm dev` (browser) | ✅ canvas shows `connected: <id>` — screenshot `docs/stage1-evidence/stage1-dev-verify.png` |
| `pnpm build` + prod server (browser) | ✅ same on one port — `docs/stage1-evidence/stage1-prod-verify.png` |
| `docker build` + `docker run` | ✅ `/healthz`=ok, client bundle served, Colyseus listening |
| `fly deploy` | ✅ live at https://genzed.fly.dev — screenshot `docs/stage1-evidence/stage1-fly-verify.png` |

## Outstanding (Stage 1)

- [ ] **CI auto-deploy:** add `FLY_API_TOKEN` as a GitHub repo secret (`fly tokens create deploy --expiry 8760h`).
- [ ] **Merge PR #1** once CI is green.

## Operational notes

- App `genzed` runs **1 shared-cpu-1x machine** in `sjc`. Fly's default is 2 for HA; scaled down because Colyseus seat reservations live in-process — matchmaking POST + WS upgrade must land on the same VM. Subsequent `fly deploy` runs preserve the count.
- Real HA later means a Redis-backed Colyseus presence so reservations survive cross-VM.

## Notable build gotchas (resolved)

- **`@genzed/shared` resolution.** Source-first exports (`./src/index.ts`) work for Vite/tsx but the compiled Node server can't load `.ts` — switched shared to `dist`-first exports and added a `prepare` script so `pnpm install` builds `shared/dist/` on a fresh clone.
- **Docker incremental-build cache.** A stale `tsconfig.tsbuildinfo` copied into the build context made `tsc` (composite) skip emit, so `shared/dist/` was never produced. Fixed by adding `**/*.tsbuildinfo` to `.dockerignore` and sequencing the package builds (shared → server → client).

## Stage 2 — what shipped

Branch `stage-2-lobby`. Adds:

- Server-authoritative phase FSM (`lobby → starting → playing → lobby`) on `ArenaRoom`.
- `onAuth` gates joins (4001 if a game is in progress, 4003 if the lobby is full at 4 players).
- 10-second reconnection grace via `allowReconnection`.
- React lobby views (`NameEntry`, `Lobby`, `CountdownOverlay`, `ReconnectingBanner`) styled with Tailwind CSS 3.
- Phaser scene swap: `HelloScene` removed, `ArenaScene` renders one label per player driven by Colyseus state.
- Two-context Playwright smoke covering the full join → start → arena flow.

## Verification (Stage 2)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean across all packages |
| `pnpm lint` | ✅ clean |
| `pnpm test` | ✅ 10 server tests (FSM + reconnection + healthz) |
| `pnpm test:e2e` | ✅ two-context smoke (~5s) |
| `pnpm dev` (browser) | ✅ join → countdown → arena — `docs/stage2-evidence/stage2-{01,02,03}-*.png` |
| `pnpm build` + prod server (browser) | ✅ same on one port — `docs/stage2-evidence/stage2-04-prod-arena.png` |
| `docker build` + `docker run` | ✅ same in container — `docs/stage2-evidence/stage2-05-docker-arena.png` |

## Stage 3 — what shipped

Branch `stage-3-movement`. Adds:

- Shared movement math in `@genzed/shared`: collision grid from the Tiled map + axis-separated AABB sweep — one simulation function (`stepPlayer`) used by both server and client, so prediction can't drift from authority.
- Server 20 Hz fixed tick (`setSimulationInterval`) with per-session input queues, a seq dup/replay guard (`input.seq <= lastProcessedInput` skipped), and the legacy 8-point spawn table ported to `shared/tuning.ts` — one deviation: legacy (896,704) overlaps a wall under our centered-AABB convention, nudged to (912,704).
- Client-side prediction + reconciliation for the local player (seq seeded from `lastProcessedInput` so reconnects don't replay), 100 ms snapshot interpolation for remote players.
- Legacy `main.json` tilemap + `playerRolls` atlas with ported walk animations — left = flipped right, exactly as the 2017 client did it.
- Follow camera bound to the local sprite, clamped to the 1120×1120 world.
- `getRoom()` identity fix in `useArenaRoom` — the room object was previously handed out via state, so every 20 Hz patch re-rendered and remounted Phaser; now a stable callback reads a ref.

## Verification (Stage 3)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean across all packages |
| `pnpm lint` | ✅ clean |
| `pnpm test` | ✅ 35 server tests (movement math, grid, collision, room FSM, movement integration, healthz) |
| `pnpm test:e2e` | ✅ 2 specs — lobby smoke + two-client movement (prediction and remote view both advance) |
| `pnpm dev` (browser) | ✅ tilemap + sprites + labels, alice y −54 px on both clients during a "w" hold — `docs/stage3-evidence/stage3-01-arena-map.png`, `stage3-02-two-players.png` |
| `pnpm build` + prod server (browser) | ✅ same on one port, map JSON served from `client/dist`; alice y −22 px (wall-stopped, consistent on both clients) — `docs/stage3-evidence/stage3-03-prod-arena.png` |
| `docker build` + `docker run` | ✅ `/healthz`=ok, full join → arena flow, alice y −54 px on both clients — `docs/stage3-evidence/stage3-04-docker-arena.png` |

## Known sharp edges for Stage 4

- **Real `end_game` trigger isn't wired** — Stage 4 wires it to win conditions; for now only the dev message handler exists.
- **`fly.toml` `min_machines_running = 0`** + `auto_stop_machines` will kill in-flight games. Bump to `1` once there's real session state.
- **Client/server Colyseus version skew** (`colyseus.js@0.15.26` vs server `@0.15.57`) — both resolve `@colyseus/schema@2.0.37` so the wire protocol matches today, but align before further wire-protocol work.
- **Roll/dodge, mouse aim, combat all deferred to Stage 4.**
- **E2E runs with `workers: 1`** — parallel spec files would share the single lobby room.
