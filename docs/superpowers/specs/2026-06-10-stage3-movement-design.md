# Stage 3 — Movement + Rendering: Design

**Date:** 2026-06-10
**Status:** Approved
**Author:** Charlie Shi
**Parent design:** [2026-05-25-genzed-modernization-design.md](2026-05-25-genzed-modernization-design.md)
**Builds on:** [2026-06-04-stage2-lobby-design.md](2026-06-04-stage2-lobby-design.md)

## Goal

Replace the placeholder `ArenaScene` with the real arena: the legacy Tiled map rendered in Phaser 3, server-authoritative WASD movement at a fixed 20 Hz tick, client-side prediction + reconciliation for the local player, and a 100 ms interpolation buffer for remote players. Legacy fidelity throughout: real player sprite with walk animations, full tilemap collision on the server, follow camera.

This is the first stage with a real netcode loop. Everything combat-related stays out (see Scope cuts).

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Player rendering | **Legacy fidelity** — `playerRolls` atlas, 4-direction walk animations + idle |
| Server collision | **Full tilemap collision** — server builds a solidity grid from `main.json` collision layers |
| Camera | **Match legacy** — follow camera on local player, world larger than viewport |
| Input cadence | **Fixed 20 Hz client input timer** (deviation from parent spec's "up to 60/s" — see Netcode) |

## Scope cuts (deferred, confirmed)

| Feature | Lands in | Why deferred |
| --- | --- | --- |
| Roll/dodge (space) | Stage 4 | Combat dodge with iframes; couples with damage |
| Mouse aim / `aim` field | Stage 4 | Aim only matters when shooting; sprite faces walk direction |
| Health, damage, death, respawn | Stage 4 | Combat scope |
| Bullets, zombies, pickups | Stage 4 | Combat scope |
| Real `end_game` trigger | Stage 4 | Needs win condition |

## Verified legacy facts (read, not guessed)

- **Map:** `legacy/client/assets/maps/main.json` — 35×35 tiles, 32 px → **1120×1120 px world**.
- **Map layers (draw order):** `floor`, `wallCollision`, `waterCollision`, `litWallCollision`, `decorationWall`, `decorationCollision`. Layers with property `collision === "true"`: `wallCollision` (285 solid tiles), `waterCollision` (0), `litWallCollision` (133). Legacy used `setCollisionByExclusion([], true, layer)` on those.
- **Walk speed:** `player.stats.movement = 100` px/s (`legacy/client/src/prefabs/player.js`). Diagonal × 0.7071 (`zgsHelpers/handlePlayerInput.js`). The `movement + 100` variants are the roll — deferred.
- **Spawn points:** 8 fixed, from `player.js`:
  `(128,128) (992,128) (384,416) (736,416) (224,704) (896,704) (96,992) (992,992)`
- **Player art:** texture atlas `images/playerRolls.png` + `playerRolls.json` (Phaser 2 `atlasJSONHash`). Animations referenced frames by numeric index: right `[44,8,5,31,12,13]`, left `[17,10,5,19,8,9]`, up `[16,0,14,6,1]`, down `[43,9,34,38,7,4]`, idle `[18]`, at 10 fps.
- **Tilesets:** `images/mapTiles/dungeon_tileset_32.png`, `images/mapTiles/objects_tilset_32.png` (typo is in the real filename).

## Architecture

```
[Browser]
  Phaser ArenaScene
    ├─ Local player: 20 Hz input sampling → apply locally (prediction) → send to server
    ├─ Remote players: render from interp buffer (100 ms behind)
    └─ Camera: startFollow(local), setBounds(0,0,1120,1120), 800×600 viewport
  React shell (lobby) — unchanged from Stage 2

        ▼ Colyseus WS (same Room instance from lobby, as in Stage 2)

[Server ArenaRoom]
  ├─ setSimulationInterval(TICK_MS) — 20 Hz, runs only in "playing" phase
  ├─ Per-player input queue, drained in seq order each tick
  ├─ Sim step: velocity from keys → shared move() vs solidity grid → world clamp
  ├─ player.lastProcessedInput = acked seq
  └─ Schema patches broadcast at tick boundary (Colyseus default)
```

One simulation, shared: the movement + collision math is pure TypeScript in `shared/`, executed identically by server (authoritative) and client (prediction). No Phaser arcade physics anywhere.

## Shared package additions

`shared/src/messages.ts`:

```ts
export const MSG_INPUT = "input";

export type InputMessage = {
  seq: number; // monotonic per client, starts at 1
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};
```

`shared/src/tuning.ts` (new — gameplay numbers ported from legacy):

```ts
export const WORLD_WIDTH = 1120;
export const WORLD_HEIGHT = 1120;
export const TILE_SIZE = 32;
export const MAP_TILES = 35;
export const PLAYER_SPEED = 100;      // px/s, legacy stats.movement
export const DIAGONAL_FACTOR = 0.7071;
export const PLAYER_SIZE = 32;        // collision AABB, refine vs atlas if needed
export const RECONCILE_SNAP_PX = 64;  // drift above → hard snap, below → lerp
export const INTERP_BUFFER_MS = 100;
export const SPAWN_POINTS = [
  { x: 128, y: 128 }, { x: 992, y: 128 },
  { x: 384, y: 416 }, { x: 736, y: 416 },
  { x: 224, y: 704 }, { x: 896, y: 704 },
  { x: 96,  y: 992 }, { x: 992, y: 992 },
] as const;
```

Tick rate stays in `shared/src/constants.ts` (`TICK_HZ = 20`, `TICK_MS = 50`) — already exists, not duplicated.

`shared/src/grid.ts` (new — pure, no deps):

```ts
export type SolidityGrid = { width: number; height: number; solid: Uint8Array };

// Builds grid from parsed Tiled JSON: any nonzero tile on a layer whose
// `collision` property === "true" is solid. Mirrors legacy setCollisionByExclusion.
export function buildSolidityGrid(tiledJson: TiledMapJson): SolidityGrid;
```

`shared/src/move.ts` (new — pure, no deps):

```ts
export type MoveInput = { up: boolean; down: boolean; left: boolean; right: boolean };

// Velocity from held keys: PLAYER_SPEED, × DIAGONAL_FACTOR when two axes held.
export function velocityFromInput(input: MoveInput): { vx: number; vy: number };

// Axis-separated AABB sweep of a PLAYER_SIZE box against the grid + world bounds.
// Move X then Y → wall sliding for free, like Phaser arcade. At 100 px/s × 50 ms
// = 5 px/tick vs 32 px tiles, tunneling is impossible.
export function move(grid: SolidityGrid, x: number, y: number, dxPx: number, dyPx: number): { x: number; y: number };

// One full tick: velocityFromInput + move over TICK_MS.
export function stepPlayer(grid: SolidityGrid, x: number, y: number, input: MoveInput): { x: number; y: number; vx: number; vy: number };
```

These export through `shared/dist/` like everything else in the package (prepare: tsc).

## Server changes

`server/src/schema/ArenaState.ts` — `Player` gains:

```ts
@type("number") x = 0;
@type("number") y = 0;
@type("number") vx = 0;
@type("number") vy = 0;
@type("uint8")  dir = 0;               // 0 down, 1 up, 2 left, 3 right — drives remote walk anims
@type("uint32") lastProcessedInput = 0;
```

`ArenaState` itself unchanged (`phase`, `countdownMs`, `players`).

`server/src/sim/collision.ts` (new):

- On room creation, read the map JSON from disk **once** (module-level cache) and `buildSolidityGrid`.
- Map file: `client/public/assets/maps/main.json` in dev; in the container the same file ships at `client/dist/assets/maps/main.json` (Vite copies `public/`). Resolution order: try dist path, fall back to public path; fail loudly if neither exists.

`server/src/rooms/ArenaRoom.ts`:

- `onCreate`: register `MSG_INPUT` handler → validate shape, push into a per-sessionId queue (cap 10, drop oldest); `setSimulationInterval(() => this.tick(), TICK_MS)`.
- `tick()`: no-op unless `phase === "playing"`. For each player, drain queue in seq order; for each input, `stepPlayer()` with the grid, write `x/y/vx/vy`, set `lastProcessedInput = seq`, update `dir` from velocity. Rule: horizontal component wins on diagonals (moving up-right shows `walk-right`); `dir` unchanged when velocity is zero (idle keeps last facing).
- Spawn assignment: when `starting` countdown completes (the existing `phase = "playing"` flip), assign each player a distinct spawn from a shuffled `SPAWN_POINTS` and zero their velocity. Done before the phase flips so the first `playing` patch already carries positions.
- `handleEndGame`: also clears input queues.
- Queues are plain `Map<string, InputMessage[]>` on the room — not schema (clients don't need them).

## Client changes

### Asset copies (verbatim from `legacy/client/assets/` → `client/public/assets/`)

| Target | Source |
| --- | --- |
| `assets/maps/main.json` | `maps/main.json` |
| `assets/images/mapTiles/dungeon_tileset_32.png` | same name |
| `assets/images/mapTiles/objects_tilset_32.png` | same name |
| `assets/images/playerRolls.png` / `.json` | same names |

### `client/src/game/animations.ts` (new)

Legacy animations use numeric atlas indices; Phaser 3 atlases use frame names. Port the legacy index tables to named-frame lists derived from `playerRolls.json` frame order, defined once here: `walk-right`, `walk-left`, `walk-up`, `walk-down`, `idle`, 10 fps, loop. Verified visually during implementation against the legacy game's look.

### `client/src/game/net/prediction.ts` (new)

- Pending-input ring buffer `{seq, input}` for the local player.
- On each schema patch: drop entries `≤ lastProcessedInput`, set authoritative `(x, y)`, replay the remainder through shared `stepPlayer()`.
- Correction policy: if `|replayed − displayed| ≤ RECONCILE_SNAP_PX` lerp the displayed position toward replayed over ~100 ms; above → hard snap. Identical math both sides means corrections are ~zero except on packet loss/reorder.

### `client/src/game/net/interpolation.ts` (new)

- Per remote player, snapshot buffer `{t, x, y, dir}` pushed on every patch (keep ~1 s).
- Each render frame sample at `now − INTERP_BUFFER_MS`, lerp between bracketing snapshots; if the buffer underruns, hold last known position.
- Moving (sampled velocity > ε) → play `dir`-keyed walk anim; else idle.

### `ArenaScene` rewrite

- `preload`: tilemap JSON, two tileset images, player atlas.
- `create`:
  - Build tilemap, add both tilesets, create all six layers in legacy draw order.
  - Build the **same** solidity grid from the loaded map JSON (`this.cache.tilemap` data) for prediction.
  - Sprites from room state `players` `onAdd`/`onRemove` (pattern unchanged from Stage 2, including the existing-items-fire-onAdd note). Name label rides above each sprite.
  - Local player: camera `startFollow`, `setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)`.
  - 20 Hz input timer (`this.time.addEvent`): sample WASD via Phaser keyboard, build `InputMessage` with next seq, apply locally via `stepPlayer`, push to pending buffer, `room.send(MSG_INPUT, msg)`. Idle inputs (no keys) are still sent — they advance `seq` and keep reconciliation simple.
  - Listener cleanup via the existing `unsubscribers` pattern + `shutdown()`.
- `update(time, delta)`: local correction lerp; remote interpolation sampling; animation state.
- Canvas stays 800×600. Phaser config gains `pixelArt: true` (32 px art, no smoothing — matches legacy `smoothed = false`).

### Unchanged

Lobby React views, `useArenaRoom`, reconnection flow, `GameMount`, view switching. A reconnected player resumes at their server-side position automatically (state re-syncs on rejoin).

## Netcode cadence (deviation from parent spec, deliberate)

Parent spec said "client input up to ~60/s". This stage fixes input sampling at **20 Hz on a timer**, matching the server tick. Each `InputMessage` represents exactly one 50 ms simulation quantum on both sides:

- Prediction replay is exact — same dt, same math, same grid → drift only on loss/reorder.
- 20 msg/s/client instead of 60 — less wire chatter.
- At 100 px/s the 50 ms input granularity is imperceptible (5 px).

If Stage 5 playtests find input latency noticeable (worst case 50 ms between key press and the next sample), revisit with sample-on-keychange + timer hybrid. Not now.

## Testing

**Server/shared (Vitest):**

- `buildSolidityGrid` against the real `main.json`: known wall cell solid, floor cell empty, all 8 spawn points non-solid, solid count = wallCollision ∪ litWallCollision.
- `move()`: stops flush at a wall; slides along a wall when moving diagonally into it; diagonal speed = 0.7071×; clamps at world bounds.
- `ArenaRoom` integration (`@colyseus/testing`): 2 join → start → countdown elapses → distinct spawn positions; inputs advance position and ack `lastProcessedInput`; inputs ignored outside `playing`; malformed input doesn't crash the room.

**E2E (Playwright):** extend the existing smoke — after both contexts reach the arena, A holds `D` ~500 ms; assert A's x increased on both pages (full loop proof). Keep zero-console-error assertion.

**Manual (evidence → `docs/stage3-evidence/`):** two browsers: walk, wall-slide, smooth remote motion, no local rubber-banding; throttled-tab check of the interp buffer. Dev + prod build + Docker, screenshots as in prior stages.

## Done criteria

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all green.
2. Map renders with legacy tilesets; player sprite walks with legacy animations.
3. Two browsers: both players move, see each other move smoothly; walls block on both screens identically.
4. Local player movement is immediate (no perceptible input → motion delay).
5. Works in `pnpm dev`, prod build, and Docker; screenshots in `docs/stage3-evidence/`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Atlas frame index → name mapping wrong | Visual check against legacy look; mapping isolated in `animations.ts` |
| Server can't locate map JSON in container | Explicit dual-path resolution + loud failure; Docker verify step in done criteria |
| Colyseus client/server version skew bites schema changes | Known sharp edge; if patches misbehave, align `colyseus.js` to `0.15.57`-compatible minor first |
| Prediction feels off despite exact math | `RECONCILE_SNAP_PX` + lerp window are tuning constants; Stage 5 owns feel |
