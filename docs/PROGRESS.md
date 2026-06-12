# Genzed Modernization — Progress

Living tracker for the 2017 → 2026 rewrite. Updated as stages land.

- **Design spec:** [docs/superpowers/specs/2026-05-25-genzed-modernization-design.md](superpowers/specs/2026-05-25-genzed-modernization-design.md)
- **Stage 1 plan:** [docs/superpowers/plans/2026-05-25-stage1-foundation.md](superpowers/plans/2026-05-25-stage1-foundation.md)
- **Stage 2 spec:** [docs/superpowers/specs/2026-06-04-stage2-lobby-design.md](superpowers/specs/2026-06-04-stage2-lobby-design.md)
- **Stage 2 plan:** [docs/superpowers/plans/2026-06-04-stage2-lobby.md](superpowers/plans/2026-06-04-stage2-lobby.md)
- **Stage 3 spec:** [docs/superpowers/specs/2026-06-10-stage3-movement-design.md](superpowers/specs/2026-06-10-stage3-movement-design.md)
- **Stage 3 plan:** [docs/superpowers/plans/2026-06-10-stage3-movement.md](superpowers/plans/2026-06-10-stage3-movement.md)
- **Stage 4 spec:** [docs/superpowers/specs/2026-06-11-stage4-combat-design.md](superpowers/specs/2026-06-11-stage4-combat-design.md)

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
| **3. Movement + rendering** | Tiled map load, server-authoritative movement, client prediction + interpolation | ✅ Shipped — merged to `master` 2026-06-10 |
| **4A. Combat — PvP GunGame** | Gun ladder, bullets, kills/respawn/win FSM, HUD, sounds, combat E2E | ✅ Built and verified on `stage-4a-combat` — not yet merged |
| **4B. Combat — Zombies + pickups** | Zombie spawner, health/speed pickups, chat, vision cone | ⬜ Not started |
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

## Stage 4A — what shipped

Branch `stage-4a-combat`, built and verified 2026-06-11. **Merged to `master` 2026-06-12** (`cd662729`, merge commit; branch kept on origin per stage convention).

- **Colyseus client alignment:** `colyseus.js` bumped to 0.15.28; single `@colyseus/schema@2.0.37` across server + client.
- **Legacy assets ported verbatim:** gun + UI sprite atlases and 8 sound files copied from `legacy/client/assets/` into `client/public/assets/`.
- **Gun ladder in `shared/src/tuning.ts`:** Pistol → SMG → Sniper → Heavy → Melee; level 6 = win state (5 kills). Constants cell-for-cell test-pinned.
- **Sim-state refactor:** `stepPlayer(grid, sim, input)` signature with a roll FSM (600 ms roll, 1000 ms cooldown from start; input-mask encodes roll direction including diagonals via `rollDirMask` uint8) shared by server tick and client prediction. Parity-tested with exact float equality: 3×400 seeded-random inputs at reconcile cadences 1/3/7, a 10-input lagged-ack scenario, and mid-roll reconciles.
- **Combat schema:** `hp`, `gunLevel`, `ammo` (-1 = infinite), `reloadStartedAt`, `aimAngle`, `immuneUntil`, `Bullet` map, `tick`, `winnerName`. React sync narrowed to phase/countdown/membership only — no 20 Hz re-renders.
- **Server-gated commands:** fire/reload/active-reload; active-reload success window [1350, 1650] ms from server reload start; miss jams until `attempt + 3500 ms`.
- **Substepped bullet integration:** ≤16 px samples (sniper at 50 px/tick takes 4 substeps) against a `wallCollision`-only bullet grid (285 solid tiles vs the player grid's 411) plus player AABBs.
- **Kill resolution:** victim respawns at a random legacy spawn with 1 s immunity (victim keeps their gun level); shooter advances +1 level with a fresh clip; rank-change feed lines use legacy-verbatim strings.
- **Win condition:** reach level 6 → `"ended"` phase + win banner → 10 s → lobby reset.
- **Client combat layer:** per-player gun sprites rotated to aim angle, crosshair cursor, dead-reckoned bullet sprites, legacy roll animations, immunity tint. HUD: 10 hearts, ammo box with 3× gun icon and `n / clip` text, rank medal, 30-frame reload bar (green success / red jam), kill feed (3 s TTL), win banner. 8 legacy sounds with distance falloff.
- **Combat E2E spec** (`tests/combat.spec.ts`): teleport to a verified line-of-sight pair → fire → bob's hp drops → "has slain" feed on both clients → alice at gun level 2 → bob respawned. Suite total: 3 specs (smoke, movement, combat).

**Operational notes:**

- `MSG_DEV_TELEPORT` test seam is registered only when `NODE_ENV !== "production"` (the Docker image sets `production`; Fly uses that image). The dev `MSG_END_GAME` reset remains unconditional (pre-existing).
- Plan addenda vs the spec (documented in the plan's "Plan addenda" section): `EVT_RELOAD_RESULT` as a targeted event; `rollDirMask` uint8 instead of a 4-way `rollDir`; `ArenaState.tick`.
- Stricter input validation orphans pre-4A clients: a stale open tab from before this deploy will have movement silently dropped until refresh.
- **Stage 5 notes:** `themeLoop.wav` is 6.1 MB uncompressed — convert to ogg/mp3 before deploy. Active-reload success flash may be imperceptible (~0–50 ms) — hold ~150 ms if playtest confirms. Client fire self-gate has zero jitter tolerance (shots may be silently dropped on bad links; server re-gates anyway).
- **CI segfault found at merge time (pre-existing since the stage-3 merge):** every master push failed `pnpm test` with exit 139 on the ubuntu runner — vitest 2.0.5 `vmThreads` vm-context teardown crashes on Linux once files hold live Colyseus servers/sockets. Invisible for three runs because the deploy job's `FLY_API_TOKEN` failure already made every run red. Fixed in PR #2 (`7f04c27e`): pool → `threads` + `singleThread`. `forks` is unusable on vitest 2.0.5 + tinypool 1.1.1 (worker stdout mangled over child IPC). **Until the Fly secret is set, judge CI by the build job, not the run conclusion.**
- **CI e2e flake (post-segfault-fix, 2× on master, same tree green on the PR):** movement's fixed 600 ms key-hold missed its >15 px displacement margin by ~0.3 px on the loaded runner, and the thrown assertion skipped `close()` — the non-consented disconnects left 10 s-grace ghosts in a `playing` room, cascading into smoke's join timeout. Fix: displacement is now `expect.poll`ed while the key is held, and movement/smoke close in `finally` (combat already did).
- **Local/CI node skew:** `.tool-versions` pins node 20.18.0 but it was never installed locally — all local gates so far ran on global node 24.15. 20.18.0 is now installed; CI-faithful run: `mise x node@20.18.0 -- pnpm -C server test`.
- **Next:** slice 4B — zombies, health/speed pickups, chat, vision cone (own plan).

## Verification (Stage 4A)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean across all packages |
| `pnpm lint` | ✅ clean |
| `pnpm test` | ✅ 75 tests / 10 files (Vitest) |
| `pnpm test:e2e` | ✅ 3/3 in dev AND 3/3 re-run against prod bundle (`PORT=8080 node server/dist/index.js`) |
| `pnpm dev` (browser) | ✅ alice kills bob; kill-feed "alice has slain bob" visible on bob's page; alice advances to gun level 2 — `docs/stage4-evidence/4a-dev-fight.png` |
| `pnpm build` + prod server (browser) | ✅ same on one port; teleport seam confirmed active in prod bundle — `docs/stage4-evidence/4a-prod-fight.png` |
| `docker build` + `docker run` | ⚠️ PENDING — Docker daemon unavailable on this dev machine. Dockerfile and `fly.toml` are byte-identical to Stage 3's verified build. Run the Docker smoke before or at deploy. |
| CI build job (ubuntu runner, Node 20) | ✅ green on PR #2 after the vitest pool fix — first-ever CI execution of the 4A suite (75/75) + e2e (3/3) on Linux |

## Known sharp edges for Stage 4

- **`fly.toml` `min_machines_running = 0`** + `auto_stop_machines` will kill in-flight games. Bump to `1` once there is real session state.
- **E2E runs with `workers: 1`** — parallel spec files would share the single lobby room.
