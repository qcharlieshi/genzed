# Stage 3 — Movement + Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder arena with the legacy Tiled map, server-authoritative WASD movement at 20 Hz, client prediction + reconciliation for the local player, and 100 ms interpolation for remotes.

**Architecture:** Movement/collision math is pure TypeScript in `shared/` (no Phaser, no Node deps), executed identically by the server (authoritative, in `ArenaRoom`'s `setSimulationInterval` tick) and the client (prediction). The client samples input on a fixed 20 Hz timer so each `InputMessage` equals exactly one 50 ms simulation quantum on both sides — replay is exact, corrections only fire on packet loss.

**Tech Stack:** Colyseus 0.15 (`setSimulationInterval`, schema 2.0.37 callable `onAdd`/`onChange`), Phaser 3.80 (tilemap, atlas, camera follow), Vitest + `@colyseus/testing`, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-10-stage3-movement-design.md` — read it first.

**Branch:** `stage-3-movement` (already created; spec committed).

---

## Critical context for implementers

- **`@genzed/shared` exports compiled `dist`, not source.** After ANY edit under `shared/src/`, run `pnpm --filter @genzed/shared build` or the server/tests will resolve stale code. Every task below bakes this into its steps — do not skip it.
- **Verified map facts** (already computed from `legacy/client/assets/maps/main.json`, do not re-derive): 35×35 tiles of 32 px → 1120×1120 world. Collision layers (`properties.collision === "true"`, string): `wallCollision`, `waterCollision` (empty), `litWallCollision`. Union solid count = **411**. Tile (0,0) is solid (map is wall-ringed); tile (1,2) is open floor. All 8 spawn tiles are open. **The tile directly above every spawn is open** (the only direction with that property — movement tests walk up).
- **Atlas facts:** `playerRolls.json` is a hash-format atlas, 47 frames, ~16×20 px each, rendered **unscaled** in legacy (`smoothed = false`). Frame-name animation tables are baked into Task 9 — they were extracted from the legacy numeric indices; do not re-derive them.
- **Old Tiled JSON format:** layer `properties` is a plain object (`{"collision": "true"}`), NOT the newer array-of-objects format. The value is the **string** `"true"`.
- Tests live in `server/src/__tests__/` only (client has no unit-test harness; prototype tier). Run a single file with `pnpm -C server exec vitest run src/__tests__/<file>.test.ts`.
- Existing room tests wait out the real 3 s countdown (`setTimeout 3300`); the new movement tests reuse that pattern.
- Colyseus schema callbacks: `players.onAdd(cb)` / `player.onChange(cb)` are **callable** in schema 2.0.37 and return a detach function — the codebase casts it `as unknown as () => void` (see current `ArenaScene`). `onAdd` fires for already-present items; guard with a `has()` check as the existing code does.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `client/public/assets/{maps,images}/...` | Create (copy) | Legacy map, tilesets, player atlas |
| `shared/src/tuning.ts` | Create | Gameplay constants ported from legacy |
| `shared/src/messages.ts` | Modify | `MSG_INPUT`, `InputMessage` |
| `shared/src/grid.ts` | Create | Tiled JSON → solidity grid |
| `shared/src/move.ts` | Create | Velocity + AABB sweep + tick step (the one true movement sim) |
| `shared/src/index.ts` | Modify | Export new modules |
| `server/src/schema/ArenaState.ts` | Modify | Player movement fields |
| `server/src/sim/mapData.ts` | Create | Load map JSON from disk, cache grid |
| `server/src/rooms/ArenaRoom.ts` | Modify | Input queues, tick loop, spawn assignment |
| `server/src/__tests__/grid.test.ts` | Create | Grid building vs the real map |
| `server/src/__tests__/move.test.ts` | Create | Sweep math on synthetic grids |
| `server/src/__tests__/arenaMovement.test.ts` | Create | Room-level movement integration |
| `client/src/lobby/arenaState.ts` | Modify | Mirror new Player fields |
| `client/src/game/animations.ts` | Create | Atlas frame tables + anim registration |
| `client/src/game/net/prediction.ts` | Create | Pending-input buffer + reconcile |
| `client/src/game/net/interpolation.ts` | Create | Remote snapshot buffer + sampling |
| `client/src/game/scenes/ArenaScene.ts` | Rewrite | Tilemap, sprites, camera, input timer |
| `client/src/game/GameMount.tsx` | Modify | `pixelArt: true` |
| `tests/helpers.ts` | Create | Shared Playwright join/start helpers |
| `tests/smoke.spec.ts` | Modify | Use helpers |
| `tests/movement.spec.ts` | Create | Two-context movement E2E |

---

### Task 1: Copy legacy assets

**Files:**
- Create: `client/public/assets/maps/main.json`
- Create: `client/public/assets/images/mapTiles/dungeon_tileset_32.png`
- Create: `client/public/assets/images/mapTiles/objects_tilset_32.png` (typo is in the real filename — keep it)
- Create: `client/public/assets/images/playerRolls.png`, `client/public/assets/images/playerRolls.json`

- [ ] **Step 1: Copy**

```bash
cd /Users/qcharlieshi/dev/genzed
mkdir -p client/public/assets/maps client/public/assets/images/mapTiles
cp legacy/client/assets/maps/main.json client/public/assets/maps/
cp legacy/client/assets/images/mapTiles/dungeon_tileset_32.png client/public/assets/images/mapTiles/
cp legacy/client/assets/images/mapTiles/objects_tilset_32.png client/public/assets/images/mapTiles/
cp legacy/client/assets/images/playerRolls.png legacy/client/assets/images/playerRolls.json client/public/assets/images/
```

- [ ] **Step 2: Verify**

Run: `ls client/public/assets/maps client/public/assets/images client/public/assets/images/mapTiles`
Expected: all five files present.

- [ ] **Step 3: Commit**

```bash
git add client/public/assets
git commit -m "feat(client): copy legacy arena map, tilesets, and player atlas verbatim"
```

---

### Task 2: Shared tuning constants + input message

**Files:**
- Create: `shared/src/tuning.ts`
- Modify: `shared/src/messages.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create `shared/src/tuning.ts`**

```ts
// Gameplay constants ported from legacy (see Stage 3 spec "Verified legacy facts").

export const TILE_SIZE = 32;
export const WORLD_WIDTH = 1120; // 35 tiles × 32 px
export const WORLD_HEIGHT = 1120;

export const PLAYER_SPEED = 100; // px/s — legacy player.stats.movement
export const DIAGONAL_FACTOR = 0.7071; // legacy used .7071, not Math.SQRT1_2
export const PLAYER_W = 16; // collision AABB = native atlas frame size (legacy rendered unscaled)
export const PLAYER_H = 20;

export const RECONCILE_SNAP_PX = 64; // drift above → hard snap; below → lerp
export const INTERP_BUFFER_MS = 100;

export const DIR_DOWN = 0;
export const DIR_UP = 1;
export const DIR_LEFT = 2;
export const DIR_RIGHT = 3;

// Legacy player.js spawn table, verbatim.
export const SPAWN_POINTS = [
  { x: 128, y: 128 },
  { x: 992, y: 128 },
  { x: 384, y: 416 },
  { x: 736, y: 416 },
  { x: 224, y: 704 },
  { x: 896, y: 704 },
  { x: 96, y: 992 },
  { x: 992, y: 992 },
] as const;
```

- [ ] **Step 2: Append to `shared/src/messages.ts`**

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

- [ ] **Step 3: Update `shared/src/index.ts`** (full new content)

```ts
export * from "./constants.js";
export * from "./messages.js";
export * from "./tuning.js";
```

- [ ] **Step 4: Build + typecheck**

Run: `pnpm --filter @genzed/shared build && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add shared/src
git commit -m "feat(shared): movement tuning constants and input message type"
```

---

### Task 3: Shared solidity grid (`grid.ts`) — TDD vs the real map

**Files:**
- Create: `shared/src/grid.ts`
- Modify: `shared/src/index.ts`
- Test: `server/src/__tests__/grid.test.ts`

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/grid.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSolidityGrid, isSolidTile, SPAWN_POINTS, TILE_SIZE, type TiledMapJson } from "@genzed/shared";

const mapJson = JSON.parse(
  readFileSync(new URL("../../../client/public/assets/maps/main.json", import.meta.url), "utf8"),
) as TiledMapJson;

describe("buildSolidityGrid (real arena map)", () => {
  const grid = buildSolidityGrid(mapJson);

  it("is 35×35", () => {
    expect(grid.width).toBe(35);
    expect(grid.height).toBe(35);
  });

  it("unions the three collision layers to exactly 411 solid tiles", () => {
    let count = 0;
    for (const v of grid.solid) count += v;
    expect(count).toBe(411);
  });

  it("marks the wall ring solid and open floor walkable", () => {
    expect(isSolidTile(grid, 0, 0)).toBe(true); // corner wall
    expect(isSolidTile(grid, 1, 2)).toBe(false); // known open floor
  });

  it("treats out-of-bounds as solid", () => {
    expect(isSolidTile(grid, -1, 0)).toBe(true);
    expect(isSolidTile(grid, 35, 0)).toBe(true);
  });

  it("keeps all 8 legacy spawn tiles walkable", () => {
    for (const p of SPAWN_POINTS) {
      expect(isSolidTile(grid, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/grid.test.ts`
Expected: FAIL — `buildSolidityGrid` is not exported from `@genzed/shared`.

- [ ] **Step 3: Create `shared/src/grid.ts`**

```ts
// Solidity grid built from the legacy Tiled JSON (old format: layer `properties`
// is a plain object and the collision flag is the string "true").

export type TiledLayer = {
  name: string;
  type: string;
  data?: number[];
  properties?: Record<string, unknown>;
};

export type TiledMapJson = {
  width: number; // tiles
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
};

export type SolidityGrid = {
  width: number; // tiles
  height: number;
  solid: Uint8Array; // 1 = blocked, row-major [ty * width + tx]
};

export function buildSolidityGrid(map: TiledMapJson): SolidityGrid {
  const solid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !layer.data) continue;
    if (layer.properties?.collision !== "true") continue;
    for (let i = 0; i < layer.data.length; i += 1) {
      if (layer.data[i] !== 0) solid[i] = 1;
    }
  }
  return { width: map.width, height: map.height, solid };
}

export function isSolidTile(grid: SolidityGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}
```

- [ ] **Step 4: Export from `shared/src/index.ts`** (add line)

```ts
export * from "./grid.js";
```

- [ ] **Step 5: Build shared, run test to verify it passes**

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/grid.test.ts`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add shared/src server/src/__tests__/grid.test.ts
git commit -m "feat(shared): solidity grid from Tiled collision layers"
```

---

### Task 4: Shared movement math (`move.ts`) — TDD on synthetic grids

**Files:**
- Create: `shared/src/move.ts`
- Modify: `shared/src/index.ts`
- Test: `server/src/__tests__/move.test.ts`

Geometry used in the tests (hand-checked): player AABB is 16×20 centered on `(x, y)` → half extents `hw = 8`, `hh = 10`. Tiles are 32 px. A player at `(80, 80)` spans x `[72, 88)`, y `[70, 90)` — vertically rows `ty = 2` only (70…89 ÷ 32), horizontally col `tx = 2` only.

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/move.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  velocityFromInput,
  move,
  stepPlayer,
  PLAYER_SPEED,
  DIAGONAL_FACTOR,
  type SolidityGrid,
} from "@genzed/shared";

function makeGrid(width: number, height: number, solidCells: Array<[number, number]> = []): SolidityGrid {
  const solid = new Uint8Array(width * height);
  for (const [tx, ty] of solidCells) solid[ty * width + tx] = 1;
  return { width, height, solid };
}

const NO_KEYS = { up: false, down: false, left: false, right: false };

describe("velocityFromInput", () => {
  it("is zero with no keys", () => {
    expect(velocityFromInput(NO_KEYS)).toEqual({ vx: 0, vy: 0 });
  });

  it("moves at PLAYER_SPEED on one axis", () => {
    expect(velocityFromInput({ ...NO_KEYS, right: true })).toEqual({ vx: PLAYER_SPEED, vy: 0 });
    expect(velocityFromInput({ ...NO_KEYS, up: true })).toEqual({ vx: 0, vy: -PLAYER_SPEED });
  });

  it("applies the diagonal factor on two axes", () => {
    const v = velocityFromInput({ ...NO_KEYS, right: true, down: true });
    expect(v.vx).toBeCloseTo(PLAYER_SPEED * DIAGONAL_FACTOR, 6);
    expect(v.vy).toBeCloseTo(PLAYER_SPEED * DIAGONAL_FACTOR, 6);
  });

  it("cancels opposing keys", () => {
    expect(velocityFromInput({ up: true, down: true, left: true, right: true })).toEqual({ vx: 0, vy: 0 });
  });
});

describe("move (axis-separated AABB sweep)", () => {
  it("moves freely in open space", () => {
    const g = makeGrid(10, 10);
    expect(move(g, 80, 80, 5, 0)).toEqual({ x: 85, y: 80 });
  });

  it("stops flush against a wall on the right", () => {
    // Solid tile (3,2) spans x [96,128). Right edge must stop at 96 → x = 96 - 8 = 88.
    const g = makeGrid(10, 10, [[3, 2]]);
    const r = move(g, 80, 80, 20, 0);
    expect(r.x).toBeCloseTo(88, 1);
    expect(r.y).toBe(80);
    // Pushing again doesn't penetrate.
    const r2 = move(g, r.x, r.y, 20, 0);
    expect(r2.x).toBeCloseTo(88, 1);
  });

  it("stops flush against a wall on the left", () => {
    // Solid tile (1,2) spans x [32,64). Left edge stops at 64 → x = 64 + 8 = 72.
    const g = makeGrid(10, 10, [[1, 2]]);
    const r = move(g, 80, 80, -20, 0);
    expect(r.x).toBeCloseTo(72, 1);
  });

  it("slides along a wall when moving diagonally into it", () => {
    const g = makeGrid(10, 10, [[3, 2]]);
    const r = move(g, 80, 80, 20, 10);
    expect(r.x).toBeCloseTo(88, 1); // clamped by the wall
    expect(r.y).toBeCloseTo(90, 6); // vertical motion unaffected
  });

  it("stops flush against floors and ceilings", () => {
    // Solid tile (2,3) spans y [96,128). Bottom edge stops at 96 → y = 96 - 10 = 86.
    const g = makeGrid(10, 10, [[2, 3]]);
    const down = move(g, 80, 80, 0, 20);
    expect(down.y).toBeCloseTo(86, 1);
    // Solid tile (2,1) spans y [32,64). Top edge stops at 64 → y = 64 + 10 = 74.
    const g2 = makeGrid(10, 10, [[2, 1]]);
    const up = move(g2, 80, 80, 0, -20);
    expect(up.y).toBeCloseTo(74, 1);
  });
});

describe("stepPlayer (one 50 ms tick)", () => {
  it("advances 5 px per tick at PLAYER_SPEED", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, 80, 80, { ...NO_KEYS, right: true });
    expect(r.x).toBeCloseTo(85, 6);
    expect(r.y).toBe(80);
    expect(r.vx).toBe(PLAYER_SPEED);
    expect(r.vy).toBe(0);
  });

  it("advances ~3.536 px per axis per tick on diagonals", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, 80, 80, { ...NO_KEYS, right: true, down: true });
    expect(r.x).toBeCloseTo(80 + PLAYER_SPEED * DIAGONAL_FACTOR * 0.05, 4);
    expect(r.y).toBeCloseTo(80 + PLAYER_SPEED * DIAGONAL_FACTOR * 0.05, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/move.test.ts`
Expected: FAIL — `velocityFromInput` is not exported from `@genzed/shared`.

- [ ] **Step 3: Create `shared/src/move.ts`**

```ts
import { TICK_MS } from "./constants.js";
import {
  PLAYER_SPEED,
  DIAGONAL_FACTOR,
  PLAYER_W,
  PLAYER_H,
  TILE_SIZE,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./tuning.js";
import { isSolidTile, type SolidityGrid } from "./grid.js";

export type MoveInput = { up: boolean; down: boolean; left: boolean; right: boolean };

const HW = PLAYER_W / 2;
const HH = PLAYER_H / 2;
const EPS = 1e-3;

export function velocityFromInput(input: MoveInput): { vx: number; vy: number } {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const factor = dx !== 0 && dy !== 0 ? DIAGONAL_FACTOR : 1;
  return { vx: dx * PLAYER_SPEED * factor, vy: dy * PLAYER_SPEED * factor };
}

function sweepX(grid: SolidityGrid, x: number, y: number, dx: number): number {
  if (dx === 0) return x;
  let newX = x + dx;
  const ty0 = Math.floor((y - HH) / TILE_SIZE);
  const ty1 = Math.floor((y + HH - EPS) / TILE_SIZE);
  if (dx > 0) {
    const tx = Math.floor((newX + HW) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      if (isSolidTile(grid, tx, ty)) return tx * TILE_SIZE - HW - EPS;
    }
  } else {
    const tx = Math.floor((newX - HW) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      if (isSolidTile(grid, tx, ty)) return (tx + 1) * TILE_SIZE + HW;
    }
  }
  return newX;
}

function sweepY(grid: SolidityGrid, x: number, y: number, dy: number): number {
  if (dy === 0) return y;
  let newY = y + dy;
  const tx0 = Math.floor((x - HW) / TILE_SIZE);
  const tx1 = Math.floor((x + HW - EPS) / TILE_SIZE);
  if (dy > 0) {
    const ty = Math.floor((newY + HH) / TILE_SIZE);
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (isSolidTile(grid, tx, ty)) return ty * TILE_SIZE - HH - EPS;
    }
  } else {
    const ty = Math.floor((newY - HH) / TILE_SIZE);
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (isSolidTile(grid, tx, ty)) return (ty + 1) * TILE_SIZE + HH;
    }
  }
  return newY;
}

// Axis-separated sweep (X then Y) of the player AABB against solid tiles, then a
// world-bounds clamp. Precondition: |dxPx| and |dyPx| < TILE_SIZE per call — holds
// at 100 px/s × 50 ms = 5 px/tick, and replay uses the same per-tick quanta.
export function move(
  grid: SolidityGrid,
  x: number,
  y: number,
  dxPx: number,
  dyPx: number,
): { x: number; y: number } {
  let nx = sweepX(grid, x, y, dxPx);
  let ny = sweepY(grid, nx, y, dyPx);
  nx = Math.min(Math.max(nx, HW), WORLD_WIDTH - HW);
  ny = Math.min(Math.max(ny, HH), WORLD_HEIGHT - HH);
  return { x: nx, y: ny };
}

// One full simulation tick (TICK_MS) — the single integration step shared by the
// server's authoritative loop and the client's prediction/replay.
export function stepPlayer(
  grid: SolidityGrid,
  x: number,
  y: number,
  input: MoveInput,
): { x: number; y: number; vx: number; vy: number } {
  const { vx, vy } = velocityFromInput(input);
  const dt = TICK_MS / 1000;
  const pos = move(grid, x, y, vx * dt, vy * dt);
  return { x: pos.x, y: pos.y, vx, vy };
}
```

- [ ] **Step 4: Export from `shared/src/index.ts`** (add line)

```ts
export * from "./move.js";
```

- [ ] **Step 5: Build shared, run test to verify it passes**

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/move.test.ts`
Expected: all passing.

- [ ] **Step 6: Run the full suite + typecheck (regression)**

Run: `pnpm --filter @genzed/shared build && pnpm test && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add shared/src server/src/__tests__/move.test.ts
git commit -m "feat(shared): axis-separated AABB movement shared by server sim and client prediction"
```

---

### Task 5: Player schema movement fields

**Files:**
- Modify: `server/src/schema/ArenaState.ts`

- [ ] **Step 1: Add fields to `Player`** (full new file content)

```ts
import { Schema, MapSchema, type } from "@colyseus/schema";
import type { Phase } from "@genzed/shared";

export class Player extends Schema {
  @type("string") name = "";
  @type("boolean") ready = false;
  @type("number") joinedAt = 0;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("uint8") dir = 0; // DIR_DOWN/UP/LEFT/RIGHT from @genzed/shared tuning
  @type("uint32") lastProcessedInput = 0;
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `pnpm test && pnpm typecheck`
Expected: clean (10 existing tests + the new grid/move tests).

- [ ] **Step 3: Commit**

```bash
git add server/src/schema/ArenaState.ts
git commit -m "feat(server): movement fields on Player schema"
```

---

### Task 6: Server map loader (`sim/mapData.ts`) — TDD

**Files:**
- Create: `server/src/sim/mapData.ts`
- Test: `server/src/__tests__/mapData.test.ts`

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/mapData.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadSolidityGrid } from "../sim/mapData.js";

describe("loadSolidityGrid", () => {
  it("loads the arena map from disk and builds a 35×35 grid", () => {
    const grid = loadSolidityGrid();
    expect(grid.width).toBe(35);
    expect(grid.height).toBe(35);
  });

  it("caches the grid (same reference on repeat calls)", () => {
    expect(loadSolidityGrid()).toBe(loadSolidityGrid());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/mapData.test.ts`
Expected: FAIL — cannot find module `../sim/mapData.js`.

- [ ] **Step 3: Create `server/src/sim/mapData.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSolidityGrid, type SolidityGrid, type TiledMapJson } from "@genzed/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In the container the map ships inside the built client bundle; in dev and in
// tests it's read from client/public. Both resolve relative to this file
// (server/src/sim or server/dist/sim → ../../../ = repo or /app root).
const CANDIDATES = [
  path.resolve(__dirname, "../../../client/dist/assets/maps/main.json"),
  path.resolve(__dirname, "../../../client/public/assets/maps/main.json"),
];

let cached: SolidityGrid | null = null;

export function loadSolidityGrid(): SolidityGrid {
  if (cached) return cached;
  for (const candidate of CANDIDATES) {
    try {
      const json = JSON.parse(readFileSync(candidate, "utf8")) as TiledMapJson;
      cached = buildSolidityGrid(json);
      return cached;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`arena map JSON not found; looked in:\n${CANDIDATES.join("\n")}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C server exec vitest run src/__tests__/mapData.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/sim/mapData.ts server/src/__tests__/mapData.test.ts
git commit -m "feat(server): load arena solidity grid from the shipped map JSON"
```

---

### Task 7: ArenaRoom movement — input queues, tick loop, spawns — TDD

**Files:**
- Modify: `server/src/rooms/ArenaRoom.ts`
- Test: `server/src/__tests__/arenaMovement.test.ts`

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/arenaMovement.test.ts`

Movement direction note: tests walk **up** (`-y`) because the tile above every spawn is verified open; left/right/down are walled for at least one spawn. One processed input = 5 px.

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import { MSG_START_GAME, MSG_INPUT, SPAWN_POINTS } from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const IDLE = { up: false, down: false, left: false, right: false };

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  c1.send(MSG_START_GAME);
  await new Promise((r) => setTimeout(r, 3300)); // real 3 s countdown
  expect(room.state.phase).toBe("playing");
  return { room, c1, c2 };
}

describe("spawn assignment", () => {
  it("places each player on a distinct legacy spawn point", async () => {
    const { room, c1, c2 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    if (!p1 || !p2) throw new Error("players missing");
    const spawnSet = new Set(SPAWN_POINTS.map((p) => `${p.x},${p.y}`));
    expect(spawnSet.has(`${p1.x},${p1.y}`)).toBe(true);
    expect(spawnSet.has(`${p2.x},${p2.y}`)).toBe(true);
    expect(`${p1.x},${p1.y}`).not.toBe(`${p2.x},${p2.y}`);
  }, 10_000);
});

describe("input processing", () => {
  it("applies inputs in order and acks lastProcessedInput", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    c1.send(MSG_INPUT, { ...IDLE, seq: 2, up: true });
    c1.send(MSG_INPUT, { ...IDLE, seq: 3, up: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(p1.y).toBeCloseTo(startY - 15, 1); // 3 inputs × 5 px, walking up
    expect(p1.lastProcessedInput).toBe(3);
  }, 10_000);

  it("ignores replayed sequence numbers", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 200));
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true }); // replay
    await new Promise((r) => setTimeout(r, 200));
    expect(p1.y).toBeCloseTo(startY - 5, 1); // only one processed
    expect(p1.lastProcessedInput).toBe(1);
  }, 10_000);

  it("ignores inputs outside the playing phase", async () => {
    colyseus = await boot(appConfig);
    const room = await colyseus.createRoom<ArenaState>("arena", {});
    const c1 = await colyseus.connectTo(room, { name: "solo" });
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 300));
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(0);
    expect(p1.lastProcessedInput).toBe(0);
  });

  it("survives malformed input payloads", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { garbage: true });
    c1.send(MSG_INPUT, { seq: "nope", up: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(room.state.phase).toBe("playing"); // room alive
    expect(p1.y).toBe(startY);
    // And valid input still works afterwards.
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(p1.y).toBeCloseTo(startY - 5, 1);
  }, 10_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/arenaMovement.test.ts`
Expected: FAIL — spawn positions are 0,0; inputs not processed.

- [ ] **Step 3: Rewrite `server/src/rooms/ArenaRoom.ts`** (full new content)

```ts
import { Room, ServerError, type Client } from "@colyseus/core";
import {
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
  MSG_END_GAME,
  MSG_INPUT,
  MSG_START_GAME,
  TICK_MS,
  SPAWN_POINTS,
  DIR_DOWN,
  DIR_UP,
  DIR_LEFT,
  DIR_RIGHT,
  stepPlayer,
  type InputMessage,
} from "@genzed/shared";
import { ArenaState, Player } from "../schema/ArenaState.js";
import { loadSolidityGrid } from "../sim/mapData.js";

const MAX_CLIENTS = 4;
const MIN_TO_START = 2;
const COUNTDOWN_MS = 3000;
const COUNTDOWN_TICK_MS = 100;
const RECONNECT_SECONDS = 10;
const MAX_QUEUED_INPUTS = 10;

function isInputMessage(m: unknown): m is InputMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.seq === "number" &&
    Number.isFinite(o.seq) &&
    typeof o.up === "boolean" &&
    typeof o.down === "boolean" &&
    typeof o.left === "boolean" &&
    typeof o.right === "boolean"
  );
}

export class ArenaRoom extends Room<ArenaState> {
  // Set higher than MAX_CLIENTS so seat reservation always succeeds and
  // onAuth is the gating point for the 4-player cap (code 4003).
  override maxClients = 100;

  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private inputQueues = new Map<string, InputMessage[]>();
  private grid = loadSolidityGrid();

  override onCreate(): void {
    this.setState(new ArenaState());
    this.onMessage(MSG_START_GAME, (client) => this.handleStartGame(client));
    this.onMessage(MSG_END_GAME, (client) => this.handleEndGame(client));
    this.onMessage(MSG_INPUT, (client, message: unknown) => this.handleInput(client, message));
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  override onAuth(_client: Client, _options: { name?: string }): boolean {
    if (this.state.phase !== "lobby") {
      throw new ServerError(CODE_GAME_IN_PROGRESS, "game in progress");
    }
    if (this.state.players.size >= MAX_CLIENTS) {
      throw new ServerError(CODE_LOBBY_FULL, "lobby full");
    }
    return true;
  }

  override onJoin(client: Client, options: { name?: string }): void {
    const player = new Player();
    player.name = (options.name ?? "anon").slice(0, 20).trim() || "anon";
    player.ready = false;
    player.joinedAt = Date.now();
    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    if (consented) {
      this.removePlayer(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      // Reconnected — sessionId preserved.
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  override onDispose(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private removePlayer(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.inputQueues.delete(sessionId);
  }

  private handleInput(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isInputMessage(message)) return;
    const queue = this.inputQueues.get(client.sessionId);
    if (!queue) return;
    queue.push(message);
    if (queue.length > MAX_QUEUED_INPUTS) queue.shift();
  }

  private tick(): void {
    if (this.state.phase !== "playing") return;
    this.state.players.forEach((player, sessionId) => {
      const queue = this.inputQueues.get(sessionId);
      if (!queue || queue.length === 0) return;
      queue.sort((a, b) => a.seq - b.seq);
      for (const input of queue) {
        if (input.seq <= player.lastProcessedInput) continue; // dup/replay guard
        const r = stepPlayer(this.grid, player.x, player.y, input);
        player.x = r.x;
        player.y = r.y;
        player.vx = r.vx;
        player.vy = r.vy;
        player.lastProcessedInput = input.seq >>> 0;
        if (r.vx !== 0 || r.vy !== 0) {
          // Horizontal wins on diagonals; facing persists when idle.
          player.dir =
            r.vx > 0 ? DIR_RIGHT : r.vx < 0 ? DIR_LEFT : r.vy > 0 ? DIR_DOWN : DIR_UP;
        }
      }
      queue.length = 0;
    });
  }

  private assignSpawns(): void {
    const points = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);
    let i = 0;
    this.state.players.forEach((player) => {
      const p = points[i % points.length];
      player.x = p.x;
      player.y = p.y;
      player.vx = 0;
      player.vy = 0;
      player.dir = DIR_DOWN;
      player.lastProcessedInput = 0;
      i += 1;
    });
  }

  private handleStartGame(_client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size < MIN_TO_START) return;
    this.state.phase = "starting";
    this.state.countdownMs = COUNTDOWN_MS;
    this.countdownInterval = setInterval(() => {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - COUNTDOWN_TICK_MS);
      if (this.state.countdownMs <= 0) {
        // Spawns are set before the phase flips so the first "playing" patch
        // already carries positions.
        this.assignSpawns();
        this.state.phase = "playing";
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
      }
    }, COUNTDOWN_TICK_MS);
  }

  private handleEndGame(_client: Client): void {
    if (this.state.phase !== "playing") return;
    this.state.phase = "lobby";
    this.state.countdownMs = 0;
    this.inputQueues.forEach((queue) => {
      queue.length = 0;
    });
    this.state.players.forEach((player) => {
      player.ready = false;
    });
  }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `pnpm -C server exec vitest run src/__tests__/arenaMovement.test.ts`
Expected: 5 passing (suite takes ~20 s — four tests wait out the 3 s countdown).

- [ ] **Step 5: Run everything (regression)**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: clean — existing FSM/reconnection tests must still pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/ArenaRoom.ts server/src/__tests__/arenaMovement.test.ts
git commit -m "feat(server): authoritative movement tick with input queues and legacy spawn assignment"
```

---

### Task 8: Client schema mirror

**Files:**
- Modify: `client/src/lobby/arenaState.ts`

- [ ] **Step 1: Update the mirror** (full new content)

```ts
import type { Phase } from "@genzed/shared";

export type LobbyPlayer = {
  name: string;
  ready: boolean;
  joinedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  lastProcessedInput: number;
  // @colyseus/schema 2.x instance callback — callable, returns a detach fn
  // (cast at the call site like the existing players.onAdd usage).
  onChange: (cb: () => void) => unknown;
};

export type LobbyPlayers = {
  size: number;
  forEach(cb: (player: LobbyPlayer, sessionId: string) => void): void;
  get(sessionId: string): LobbyPlayer | undefined;
  values(): IterableIterator<LobbyPlayer>;
  keys(): IterableIterator<string>;
  onAdd: (cb: (player: LobbyPlayer, sessionId: string) => void) => void;
  onRemove: (cb: (player: LobbyPlayer, sessionId: string) => void) => void;
};

export type ArenaState = {
  phase: Phase;
  countdownMs: number;
  players: LobbyPlayers;
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean (fields are additive; lobby components unaffected).

- [ ] **Step 3: Commit**

```bash
git add client/src/lobby/arenaState.ts
git commit -m "feat(client): mirror movement fields on the schema type"
```

---

### Task 9: Player animations (`animations.ts`)

**Files:**
- Create: `client/src/game/animations.ts`

The frame-name tables below were derived from the legacy numeric indices against `playerRolls.json` hash order — **use them verbatim, do not re-derive**. Legacy also flipped `scale.x = -1` while moving left; we use the dedicated left frames without flipping first, and flip only if visual verification (Task 13) shows mirrored-looking frames.

- [ ] **Step 1: Create `client/src/game/animations.ts`**

```ts
import type Phaser from "phaser";
import { DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT } from "@genzed/shared";

export const PLAYER_ATLAS = "player";
export const IDLE_FRAME = "playerSprites_243.png";

export const ANIM = {
  down: "walk-down",
  up: "walk-up",
  left: "walk-left",
  right: "walk-right",
  idle: "idle",
} as const;

export const DIR_ANIM: Record<number, string> = {
  [DIR_DOWN]: ANIM.down,
  [DIR_UP]: ANIM.up,
  [DIR_LEFT]: ANIM.left,
  [DIR_RIGHT]: ANIM.right,
};

// Legacy player.js animation tables (numeric atlas indices), resolved to the
// frame names at those positions in playerRolls.json. 10 fps, looping.
const FRAMES: Record<string, string[]> = {
  [ANIM.right]: [
    "playerSprites_57 copy.png",
    "lookingRightRightLegUp.png",
    "RightComingDown1.png",
    "playerSprites_266 copy.png",
    "movingRight4.png",
    "movingRight5.png",
  ],
  [ANIM.left]: [
    "okeydokey.png",
    "movingLeft4.png",
    "RightComingDown1.png",
    "playerSprites_244.png",
    "lookingRightRightLegUp.png",
    "moveRightBothLegsUp (1).png",
  ],
  [ANIM.up]: [
    "movingUpRightFootDown.png",
    "FootComingDownRunningUpLeft.png",
    "movingUpAboutLeftFootDown.png",
    "RunningUp1.png",
    "FootComingDownRunningUpRight.png",
  ],
  [ANIM.down]: [
    "playerSprites_34 copy.png",
    "moveRightBothLegsUp (1).png",
    "playerSprites_29 copy.png",
    "playerSprites_30 copy.png",
    "bothFeetInAir1Down.png",
    "OneFootRunningDownLookingLeft.png",
  ],
  [ANIM.idle]: [IDLE_FRAME],
};

export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const [key, frames] of Object.entries(FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: -1,
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/game/animations.ts
git commit -m "feat(client): port legacy walk animations to named atlas frames"
```

---

### Task 10: Prediction + interpolation helpers

**Files:**
- Create: `client/src/game/net/prediction.ts`
- Create: `client/src/game/net/interpolation.ts`

No unit tests: the integration math (`stepPlayer`) is covered by the server-side suite; the buffering glue is covered by the movement E2E (Task 12) and manual verification (Task 13). Prototype tier.

- [ ] **Step 1: Create `client/src/game/net/prediction.ts`**

```ts
import { stepPlayer, type InputMessage, type MoveInput, type SolidityGrid } from "@genzed/shared";

// Client-side prediction for the local player. `x/y` is the predicted position;
// the scene renders toward it. Reconcile rebases onto the server's authoritative
// position and replays unacked inputs — identical math both sides, so the result
// matches the prediction except after packet loss/reorder.
export class LocalPrediction {
  x: number;
  y: number;
  private pending: InputMessage[] = [];
  private nextSeq: number;

  // nextSeq must continue from the server's lastProcessedInput + 1 — on a
  // mid-game reconnect the server has already acked earlier seqs, and the
  // replay guard drops anything at or below that watermark.
  constructor(
    x: number,
    y: number,
    private grid: SolidityGrid,
    nextSeq = 1,
  ) {
    this.x = x;
    this.y = y;
    this.nextSeq = nextSeq;
  }

  // Sample one 20 Hz input: apply locally, queue for reconciliation, return the
  // message to send to the server.
  sample(input: MoveInput): InputMessage {
    const msg: InputMessage = { seq: this.nextSeq, ...input };
    this.nextSeq += 1;
    this.pending.push(msg);
    const r = stepPlayer(this.grid, this.x, this.y, msg);
    this.x = r.x;
    this.y = r.y;
    return msg;
  }

  reconcile(serverX: number, serverY: number, lastProcessedInput: number): void {
    this.pending = this.pending.filter((p) => p.seq > lastProcessedInput);
    let x = serverX;
    let y = serverY;
    for (const p of this.pending) {
      const r = stepPlayer(this.grid, x, y, p);
      x = r.x;
      y = r.y;
    }
    this.x = x;
    this.y = y;
  }
}
```

- [ ] **Step 2: Create `client/src/game/net/interpolation.ts`**

```ts
import { INTERP_BUFFER_MS } from "@genzed/shared";

type Snapshot = { t: number; x: number; y: number; dir: number };

export type InterpSample = { x: number; y: number; dir: number; moving: boolean };

// Render remote players INTERP_BUFFER_MS in the past, lerping between the two
// bracketing server snapshots (standard Colyseus interpolation pattern).
export class RemoteInterpolation {
  private buf: Snapshot[] = [];

  push(x: number, y: number, dir: number): void {
    const now = performance.now();
    this.buf.push({ t: now, x, y, dir });
    const cutoff = now - 1000;
    while (this.buf.length > 2 && this.buf[0].t < cutoff) this.buf.shift();
  }

  sample(): InterpSample | null {
    const n = this.buf.length;
    if (n === 0) return null;
    const target = performance.now() - INTERP_BUFFER_MS;
    const newest = this.buf[n - 1];
    if (target >= newest.t) {
      return { x: newest.x, y: newest.y, dir: newest.dir, moving: false };
    }
    const oldest = this.buf[0];
    if (target <= oldest.t) {
      return { x: oldest.x, y: oldest.y, dir: oldest.dir, moving: false };
    }
    for (let i = n - 2; i >= 0; i -= 1) {
      const a = this.buf[i];
      if (a.t <= target) {
        const b = this.buf[i + 1];
        const f = (target - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          dir: b.dir,
          moving: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 0.5,
        };
      }
    }
    return { x: oldest.x, y: oldest.y, dir: oldest.dir, moving: false };
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/game/net/prediction.ts client/src/game/net/interpolation.ts
git commit -m "feat(client): local prediction and remote interpolation buffers"
```

---

### Task 11: ArenaScene rewrite + GameMount pixelArt

**Files:**
- Rewrite: `client/src/game/scenes/ArenaScene.ts`
- Modify: `client/src/game/GameMount.tsx`

- [ ] **Step 1: Rewrite `client/src/game/scenes/ArenaScene.ts`** (full new content)

```ts
import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  MSG_INPUT,
  TICK_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  RECONCILE_SNAP_PX,
  buildSolidityGrid,
  type MoveInput,
  type SolidityGrid,
  type TiledMapJson,
} from "@genzed/shared";
import type { ArenaState, LobbyPlayer } from "../../lobby/arenaState.js";
import { ANIM, DIR_ANIM, IDLE_FRAME, PLAYER_ATLAS, registerPlayerAnimations } from "../animations.js";
import { LocalPrediction } from "../net/prediction.js";
import { RemoteInterpolation } from "../net/interpolation.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

type PlayerView = {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  interp: RemoteInterpolation | null; // null for the local player
  unsubscribe: () => void;
};

type ArenaDebugHook = {
  players: () => Array<{ id: string; x: number; y: number; local: boolean }>;
};

const MAP_KEY = "arena-map";
const TILESET_KEYS = ["dungeon", "dungeonObjs"] as const; // must match tileset names in main.json
const LAYER_NAMES = [
  "floor",
  "wallCollision",
  "waterCollision",
  "litWallCollision",
  "decorationWall",
  "decorationCollision",
]; // legacy draw order

const LABEL_STYLE = {
  color: "#9ae6b4",
  fontFamily: "monospace",
  fontSize: "10px",
} as const;

export class ArenaScene extends Phaser.Scene {
  private room!: Room<ArenaState>;
  private localSessionId = "";
  private views = new Map<string, PlayerView>();
  private grid!: SolidityGrid;
  private prediction: LocalPrediction | null = null;
  private keys!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super("arena");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/main.json");
    this.load.image("dungeon", "assets/images/mapTiles/dungeon_tileset_32.png");
    this.load.image("dungeonObjs", "assets/images/mapTiles/objects_tilset_32.png");
    this.load.atlas(PLAYER_ATLAS, "assets/images/playerRolls.png", "assets/images/playerRolls.json");
  }

  create(data: ArenaSceneData): void {
    this.room = data.room;
    this.localSessionId = data.localSessionId;

    const map = this.make.tilemap({ key: MAP_KEY });
    const tilesets = TILESET_KEYS.map((key) => {
      const ts = map.addTilesetImage(key, key);
      if (!ts) throw new Error(`tileset missing from map: ${key}`);
      return ts;
    });
    for (const name of LAYER_NAMES) {
      map.createLayer(name, tilesets, 0, 0);
    }

    // Same grid the server simulates against, built from the same JSON.
    const mapJson = this.cache.tilemap.get(MAP_KEY)?.data as TiledMapJson;
    this.grid = buildSolidityGrid(mapJson);

    registerPlayerAnimations(this);

    // onAdd fires for existing items in @colyseus/schema 2.x — no separate forEach.
    this.unsubscribers.push(
      this.room.state.players.onAdd((p, id) => {
        if (!this.views.has(id)) this.addPlayer(id, p);
      }) as unknown as () => void,
      this.room.state.players.onRemove((_p, id) => this.removePlayer(id)) as unknown as () => void,
    );

    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as ArenaScene["keys"];
    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.sampleInput() });

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // E2E hook (read by tests/movement.spec.ts).
    (window as unknown as { __arena?: ArenaDebugHook }).__arena = {
      players: () =>
        [...this.views.entries()].map(([id, view]) => ({
          id,
          x: view.sprite.x,
          y: view.sprite.y,
          local: id === this.localSessionId,
        })),
    };
  }

  private addPlayer(sessionId: string, player: LobbyPlayer): void {
    const isLocal = sessionId === this.localSessionId;
    const sprite = this.add.sprite(player.x, player.y, PLAYER_ATLAS, IDLE_FRAME);
    sprite.play(ANIM.idle);
    const label = this.add
      .text(player.x, player.y - 14, isLocal ? `${player.name} (you)` : player.name, LABEL_STYLE)
      .setOrigin(0.5, 1);

    if (isLocal) {
      // Seed the seq counter past the server's watermark so a mid-game
      // reconnect doesn't send seqs the replay guard has already acked.
      this.prediction = new LocalPrediction(
        player.x,
        player.y,
        this.grid,
        player.lastProcessedInput + 1,
      );
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      const unsubscribe = player.onChange(() => {
        this.prediction?.reconcile(player.x, player.y, player.lastProcessedInput);
      }) as unknown as () => void;
      this.views.set(sessionId, { sprite, label, interp: null, unsubscribe });
    } else {
      const interp = new RemoteInterpolation();
      interp.push(player.x, player.y, player.dir);
      const unsubscribe = player.onChange(() => {
        interp.push(player.x, player.y, player.dir);
      }) as unknown as () => void;
      this.views.set(sessionId, { sprite, label, interp, unsubscribe });
    }
  }

  private removePlayer(sessionId: string): void {
    const view = this.views.get(sessionId);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    view.label.destroy();
    this.views.delete(sessionId);
  }

  private sampleInput(): void {
    if (!this.prediction) return;
    const input: MoveInput = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
    };
    const msg = this.prediction.sample(input);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);
  }

  private updateLocalAnimation(input: MoveInput): void {
    const view = this.views.get(this.localSessionId);
    if (!view) return;
    const moving = input.up || input.down || input.left || input.right;
    if (!moving) {
      view.sprite.play(ANIM.idle, true);
      return;
    }
    // Horizontal wins on diagonals — same rule as the server's `dir`.
    const key = input.right ? ANIM.right : input.left ? ANIM.left : input.down ? ANIM.down : ANIM.up;
    view.sprite.play(key, true);
  }

  update(_time: number, delta: number): void {
    // Local player: render toward the predicted position. Prediction advances in
    // 5 px steps at 20 Hz; the per-frame lerp smooths that into continuous motion.
    const local = this.views.get(this.localSessionId);
    if (local && this.prediction) {
      const dx = this.prediction.x - local.sprite.x;
      const dy = this.prediction.y - local.sprite.y;
      if (Math.hypot(dx, dy) > RECONCILE_SNAP_PX) {
        local.sprite.setPosition(this.prediction.x, this.prediction.y);
      } else {
        const k = Math.min(1, delta / TICK_MS);
        local.sprite.x += dx * k;
        local.sprite.y += dy * k;
      }
    }

    // Remote players: sample INTERP_BUFFER_MS in the past.
    this.views.forEach((view, id) => {
      if (id === this.localSessionId) return;
      const s = view.interp?.sample();
      if (!s) return;
      view.sprite.setPosition(s.x, s.y);
      view.sprite.play(s.moving ? DIR_ANIM[s.dir] : ANIM.idle, true);
    });

    // Labels ride above sprites.
    this.views.forEach((view) => {
      view.label.setPosition(view.sprite.x, view.sprite.y - 14);
    });
  }

  shutdown(): void {
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    });
    this.unsubscribers = [];
    this.views.forEach((view) => view.unsubscribe());
    this.views.clear();
    this.prediction = null;
  }
}
```

- [ ] **Step 2: Add `pixelArt` to `client/src/game/GameMount.tsx`** — in the `new Phaser.Game({...})` config, add one line after `backgroundColor`:

```ts
      pixelArt: true,
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Manual sanity check in dev**

Run: `pnpm dev`, open two browsers at `http://localhost:5173`, join as two players, start the game.
Expected: tilemap renders, both player sprites appear on spawn points, WASD moves your player immediately, the other browser shows your movement smoothly, walls block movement.

- [ ] **Step 5: Commit**

```bash
git add client/src/game
git commit -m "feat(client): real arena scene — tilemap, prediction, interpolation, follow camera"
```

---

### Task 12: Movement E2E

**Files:**
- Create: `tests/helpers.ts`
- Modify: `tests/smoke.spec.ts`
- Create: `tests/movement.spec.ts`

- [ ] **Step 1: Extract shared helpers** — create `tests/helpers.ts`

```ts
import { expect, type Browser, type Page } from "@playwright/test";

export async function joinAs(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "player name" }).fill(name);
  await page.getByRole("button", { name: /join lobby/i }).click();
  await expect(page.getByText(`${name}`).first()).toBeVisible({ timeout: 10_000 });
}

export async function twoPlayersInArena(browser: Browser): Promise<{
  pageA: Page;
  pageB: Page;
  errors: string[];
  close: () => Promise<void>;
}> {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errors: string[] = [];
  for (const p of [pageA, pageB]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }

  await joinAs(pageA, "alice");
  await joinAs(pageB, "bob");
  await expect(pageA.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await expect(pageB.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await pageA.getByRole("button", { name: /start game/i }).click();
  for (const p of [pageA, pageB]) {
    await expect(p.locator("canvas").first()).toBeVisible({ timeout: 8_000 });
  }

  return {
    pageA,
    pageB,
    errors,
    close: async () => {
      await ctxA.close();
      await ctxB.close();
    },
  };
}
```

- [ ] **Step 2: Rewrite `tests/smoke.spec.ts` to use the helpers**

```ts
import { test, expect } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

test("two players join, host starts, both see the arena", async ({ browser }) => {
  const { pageA, errors, close } = await twoPlayersInArena(browser);
  await pageA.waitForTimeout(500); // allow scenes to settle
  await close();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Create `tests/movement.spec.ts`**

Direction note: the test walks **up** (`w` key) — the only direction guaranteed open from every spawn point. One open tile guarantees ≥22 px of travel; a 600 ms hold attempts ~60 px, so asserting ≥15 px is safe regardless of which spawn was assigned.

```ts
import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

type DebugPlayer = { id: string; x: number; y: number; local: boolean };

async function players(page: Page): Promise<DebugPlayer[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players: () => DebugPlayer[] } }).__arena;
    return hook ? hook.players() : [];
  });
}

test("movement propagates: local prediction and remote view both advance", async ({ browser }) => {
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);

  // Wait for sprites to register on both pages.
  await expect.poll(async () => (await players(pageA)).length, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await players(pageB)).length, { timeout: 5_000 }).toBe(2);

  const beforeA = (await players(pageA)).find((p) => p.local);
  const beforeB = (await players(pageB)).find((p) => !p.local);
  if (!beforeA || !beforeB) throw new Error("players not found in debug hook");

  await pageA.locator("canvas").click(); // focus
  await pageA.keyboard.down("w");
  await pageA.waitForTimeout(600);
  await pageA.keyboard.up("w");
  await pageA.waitForTimeout(400); // server settle + interp catch-up

  const afterA = (await players(pageA)).find((p) => p.local);
  const afterB = (await players(pageB)).find((p) => !p.local);
  if (!afterA || !afterB) throw new Error("players not found in debug hook");

  // Alice moved up on her own screen (prediction)...
  expect(beforeA.y - afterA.y).toBeGreaterThan(15);
  // ...and on Bob's screen (server broadcast + interpolation).
  expect(beforeB.y - afterB.y).toBeGreaterThan(15);

  await close();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 4: Run E2E**

Run: `pnpm test:e2e`
Expected: both spec files pass (~25 s total).

- [ ] **Step 5: Commit**

```bash
git add tests
git commit -m "test(e2e): movement propagates across two clients"
```

---

### Task 13: Full verification, evidence, docs

**Files:**
- Create: `docs/stage3-evidence/` screenshots
- Modify: `docs/PROGRESS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full local gate**

Run: `pnpm --filter @genzed/shared build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green.

- [ ] **Step 2: Manual dev verification + screenshots**

`pnpm dev`, two browsers, join + start. Verify and capture to `docs/stage3-evidence/`:
- `stage3-01-arena-map.png` — tilemap rendered, sprites on spawns
- `stage3-02-two-players.png` — both browsers side by side mid-movement
- Walls block movement; sliding along walls works; remote motion smooth; local input → motion is immediate; left/right walk animations look correct (not mirrored — if mirrored, fix `animations.ts` per its comment and re-verify)

- [ ] **Step 3: Prod build verification**

```bash
pnpm build
PORT=8080 node server/dist/index.js
```
Open two browsers at `http://localhost:8080`, repeat the movement check. Screenshot `stage3-03-prod-arena.png`. This also proves the server found the map JSON via the `client/dist` path.

- [ ] **Step 4: Docker verification**

```bash
docker build -t genzed:stage3 .
docker run --rm -p 8080:8080 -e PORT=8080 genzed:stage3
```
Repeat the two-browser movement check at `http://localhost:8080`. Screenshot `stage3-04-docker-arena.png`.

- [ ] **Step 5: Update `docs/PROGRESS.md`**

- Staged-delivery table: Stage 2 → "✅ Shipped", Stage 3 → "🟡 In PR — branch `stage-3-movement`".
- Add links to the Stage 3 spec and this plan in the header list.
- Add a "Stage 3 — what shipped" section (FSM additions: input queues + 20 Hz tick + spawns; shared movement math; prediction/interpolation; tilemap + animations) and a "Verification (Stage 3)" table mirroring the Stage 2 format.
- Refresh "Known sharp edges": remove the "ArenaScene is a placeholder" and "No spawn positions" entries; keep end_game, fly min_machines, version-skew notes; add "roll/aim/combat deferred to Stage 4".

- [ ] **Step 6: Update `CLAUDE.md`**

- Staged delivery list: mark Stage 3 ✅ (or 🟡 In PR until merge).
- "Known sharp edges": same edits as PROGRESS.md.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: Stage 3 verification evidence and tracker updates"
```

---

## Done criteria (from the spec)

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all green.
2. Map renders with legacy tilesets; player sprite walks with legacy animations.
3. Two browsers: both players move, see each other move smoothly; walls block on both screens identically.
4. Local player movement is immediate (no perceptible input → motion delay).
5. Works in `pnpm dev`, prod build, and Docker; screenshots in `docs/stage3-evidence/`.
