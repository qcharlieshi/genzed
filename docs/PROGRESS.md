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
| **4B. Combat — Zombies + pickups** | Zombie spawner, health/speed pickups, chat, vision cone | ✅ Built and verified on `stage-4b-world` — not yet merged |
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
- **Stage 5 notes:** `themeLoop.wav` is 6.1 MB uncompressed — convert to ogg/mp3 before deploy. Active-reload success flash may be imperceptible (~0–50 ms) — hold ~150 ms if playtest confirms. Client fire self-gate has zero jitter tolerance (shots may be silently dropped on bad links; server re-gates anyway). Client keeps sending input for a frame after a consented leave (benign "WebSocket is already in CLOSING" console noise) — stop the input loop on leave.
- **CI segfault found at merge time (pre-existing since the stage-3 merge):** every master push failed `pnpm test` with exit 139 on the ubuntu runner — vitest 2.0.5 `vmThreads` vm-context teardown crashes on Linux once files hold live Colyseus servers/sockets. Invisible for three runs because the deploy job's `FLY_API_TOKEN` failure already made every run red. Fixed in PR #2 (`7f04c27e`): pool → `threads` + `singleThread`. `forks` is unusable on vitest 2.0.5 + tinypool 1.1.1 (worker stdout mangled over child IPC). **Until the Fly secret is set, judge CI by the build job, not the run conclusion.**
- **CI e2e flake (post-segfault-fix, 2× on master, same tree green on the PR):** movement's fixed 600 ms key-hold missed its >15 px displacement margin by ~0.3 px on the loaded runner, and the thrown assertion skipped `close()` — the non-consented disconnects left 10 s-grace ghosts in a `playing` room, cascading into smoke's join timeout. Fix: displacement is now `expect.poll`ed while the key is held, and movement/smoke close in `finally` (combat already did). Fixing those unmasked a third defect: a benign "WebSocket is already in CLOSING or CLOSED state" console error (last input send racing the consented-leave close) tripped the zero-tolerance `errors` assertion — filtered as known-benign in the helper collector, same policy as combat's autoplay filter.
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

## Stage 4B — what shipped

Branch `stage-4b-world`, built and verified 2026-06-12. Not yet merged.

**Zombie spawner + AI:**
- Server-stepped zombies on the 20 Hz tick, reusing the shared `move()` AABB sweep for wall-sliding navigation (4.55 px/tick at 91 px/s, well under the 32 px precondition).
- Targeting: nearest player (spec deviation 1 — legacy selected the farthest). Greedy steering, no pathfinding.
- In attack range (28 px): zombie stands still and swings every 1 s; attacks skip immune players. Zombie deals 5 hp per attack.
- One-hit kill by any bullet; corpse anim plays 4 s then the Zombie schema entry is deleted.
- Spawner: one zombie per 4000 ms (**INVENTED** — playtest-tune) up to 8 alive (**INVENTED** — playtest-tune). Game-reset and win clear all zombies.
- 8 spawn points ported from `legacy/enemyGenerator.js` (10 → 8 unique); 3 nudged ≤16 px into verified-open floor: `(250,250)→(266,250)`, `(700,700)→(700,716)`, `(800,800)→(784,800)`. Pinned against the real map by `world.test.ts`.
- Zombie kills produce no kill-feed line and no gun-level credit (legacy-verified, plan addendum 4).

**Pickups:**
- Health pack: +30 hp below 70 threshold; at/above 70 → set to 100. Legacy rule from `managePickups.js:84-87`.
- Speed boost: +100 px/s, threads through existing `Player.speedBonus` field (refreshes, never stacks — plan deviation 4). Expires after 5 s; `computeSpeedBonus` composes the L5 gun bonus and the live pickup so level-up in `resolveHit` can't clobber an active pickup.
- Pickup respawn: 8 s cycling to a random unoccupied slot (11 legacy slots, verbatim from `managePickups.js:26-36`).
- Initial layout: health @ slots 4 + 1, speed @ slots 6 + 8. Feed lines port legacy strings verbatim.
- Client prediction needs zero new code — `speedBonus` is already a `PlayerSim` field tracked by reconciliation.

**Chat relay:**
- Server-gated relay: ≤200 chars (trimmed), 1 message/s per player, active only in `playing`/`ended` phases.
- TAB toggle overlay in React (`ChatOverlay.tsx`) mounts over the Phaser canvas in `GameMount.tsx`; full keyboard input suppression while open (no movement, no fire, no roll while typing).
- Chat box closes on send (legacy behavior). Messages visible only while the overlay is open (no persistent HUD history). No unread indicator — messages are invisible until TAB.
- Chat placeholder: `Talk some smack here...` (legacy verbatim).

**Vision cone (SHIPPED — not cut):**
- Client-only rendering using one `Phaser.GameObjects.Graphics` object and two `Phaser.Display.Masks.GeometryMask` instances: one normal mask revealing lit pixels, one inverted mask darkening the rest.
- 60 rays cast at 90° × 270 px, using the `wallCollision ∪ litWallCollision` grid (plan addendum 7 — player grid would make water opaque; bullet grid would let lit walls leak).
- Darkness alpha 0.7 (legacy `Lighting.js:29`). The cone follows the local player's aim angle (mouse position) every frame.
- Remote players and zombies/pickups are only visible inside the local player's cone.

**Plan addenda vs the spec (all 7 summarized):**
1. Spawn/slot validation is test-pinned (not boot-time runtime nudging) — 3 zombie spawn points nudged in constants, 11 pickup slots validated by center-tile floor check. Pinned by `world.test.ts`.
2. `EVT_ZOMBIE_ATTACK { x, y }` broadcast added — clients need it to spatially play `zombieHit.wav` (server-side attacks are otherwise invisible to the client).
3. Two zombie dev seams (`MSG_DEV_ZOMBIE_SPAWNING`, `MSG_DEV_SPAWN_ZOMBIE`) registered under the same `NODE_ENV !== "production"` guard as `MSG_DEV_TELEPORT` — spawner disable keeps E2E assertions deterministic; explicit spawn bypasses greedy-steering flakiness.
4. Zombie kills produce no feed line and no credit — verified in legacy `enemy.js:30-40` (`receiveDamage` called with no killer, so the slain-line branch never ran).
5. Zombies stand still in attack range (no orbiting) — legacy pathfinding returned empty path at range.
6. Chat gates to `playing`/`ended` only; closes on send; messages show only while overlay is open.
7. Vision cone sight grid = `wallCollision` + `litWallCollision` — a third grid compiled at scene create. Player grid would make water opaque; bullet grid would let lit-wall sprites leak light.

**Operational notes:**
- `MSG_DEV_TELEPORT`, `MSG_DEV_ZOMBIE_SPAWNING`, `MSG_DEV_SPAWN_ZOMBIE` are all registered only when `NODE_ENV !== "production"` — the Fly Docker image sets `production`, so these seams are test-only.
- `arenaCombat.test.ts` fixtures disable the spawner on startup (`c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false })`) to prevent zombie hp-chip interfering with the respawn-hp assertions over long fixture windows.
- The `PW_BASE_URL` env var was added to `playwright.config.ts` in this task — callers can point E2E at any running server (prod bundle at `:8080`, CI dev stack, etc.) without changing the config.

## Verification (Stage 4B)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ clean across all packages |
| `pnpm lint` | ✅ clean |
| `pnpm test` (Node 20 CI-faithful: `mise x node@20.18.0 -- pnpm -C server test`) | ✅ 100 tests / 14 files |
| `pnpm test:e2e` (dev stack, `CI=1`) | ✅ 4/4 (smoke, movement, combat, world) |
| `pnpm build` + prod-bundle E2E (`PW_BASE_URL=http://localhost:8080`) | ✅ 4/4 — NODE_ENV unset keeps dev seams active in prod bundle, same as 4A |
| `pnpm dev` (browser) | ✅ zombies converge on alice, pickup feed "alice has picked up a health pack!", hp drops from zombie attacks, cone visible — `docs/stage4-evidence/4b-zombies.png` |
| Chat overlay | ✅ TAB opens overlay on alice; "gg ez" relayed and visible on bob's screen — `docs/stage4-evidence/4b-chat.png` |
| Vision cone | ✅ one Graphics + two GeometryMasks, 60 rays, 90° × 270 px, 0.7 darkness — `docs/stage4-evidence/4b-cone.png` |
| `docker build` + `docker run` | ⚠️ PENDING — Docker daemon unavailable on this dev machine. Dockerfile is byte-identical to Stage 3's and 4A's verified build. Run the Docker smoke before or at deploy. |

## Stage 5 — carry-forward notes

(Appended from 4B)

- **Chat has no unread indicator** — messages are invisible until TAB; a badge or glow on the TAB key would be a natural Stage-5 addition.
- **Zombie groan volume curve is legacy-quirky** — the `-0.2` distance offset in the legacy audio code produces subtly non-linear attenuation; may need playtest rebalancing.
- **Spawner numbers need playtest tuning** — `ZOMBIE_SPAWN_INTERVAL_MS=4000` and `ZOMBIE_MAX_ALIVE=8` are invented starting guesses, not legacy-derived.
- **`themeLoop.wav` 6.1 MB conversion still outstanding** — convert to ogg/mp3 before the next Fly deploy (carried from 4A Stage-5 notes).
