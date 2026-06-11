# Stage 4A — PvP Gun-Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete, deployable PvP arena on the server-authoritative sim: mouse aim, full-auto guns, bullets, damage, the 5-level GunGame ladder, roll, respawn + immunity, active reload, win FSM with banner → lobby reset, kill feed, HUD, and sounds.

**Architecture:** All combat is server-stepped at the existing 20 Hz tick. Bullets are schema entities integrated with substepping against a wallCollision-only grid plus player AABBs; clients dead-reckon them. Roll and per-player speed thread through the ONE shared simulation (`stepPlayer` becomes sim-state → sim-state), so client prediction/replay stays exact — a parity test locks this. Fire/reload/active-reload are server-gated commands outside the seq'd input channel. Transient FX ride broadcasts (`EVT_SHOT`, `EVT_LOG`).

**Tech Stack:** Colyseus 0.15 (server 0.15.57, client aligned to colyseus.js 0.15.28, schema 2.0.37), Phaser 3.80, Vitest + @colyseus/testing, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-11-stage4-combat-design.md` — read it first. This plan covers slice **4A only** (zombies/pickups/chat/vision-cone are 4B, planned separately).

**Branch:** `stage-4a-combat` (already created; this plan is its first commit).

---

## Critical context for implementers

- **`@genzed/shared` exports compiled `dist`, not source.** After ANY edit under `shared/src/`, run `pnpm --filter @genzed/shared build` or server/tests/client resolve stale code. Baked into every task — do not skip.
- **`noUncheckedIndexedAccess` is ON** repo-wide. Indexed reads type as `T | undefined`. All code below is written index-safe — keep it that way.
- **Tick math:** 20 Hz, `TICK_MS = 50`. Roll = 12 ticks (600 ms) + 20-tick cooldown from roll start (1000 ms). Sniper bullets move 50 px/tick → substepped at ≤16 px (`move()`'s <32 px precondition rules it out for bullets; bullets use their own integrator).
- **Verified atlas facts (use verbatim, do not re-derive).** `finalGunSheet.json` hash order: index 0 `New Piskel (11).png`, 1 `New Piskel (15).png`, 2 `New Piskel (16).png`, 3 `New Piskel (17).png`, 4 `New Piskel (6).png`, 5 `ak5 (1).png`, 6 `pistol.png`, 7 `pistolBullet.png`. Legacy gun frames by level 1–5 = [6, 5, 1, 3, 4]; bullet frames = [7, 0, 2, 3, 4] (`player.js:198-254`, `gun.js:85-103`) — already resolved to names in the `GUNS` table (Task 3). `crosshair.json` has one frame `reticle_box_001.png`. `medals.json`: `medals_01.png`…`medals_04.png` (rank 1→4). `reloadBar.json`: 30 frames `New Piskel (14)_01.png`…`New Piskel (14)_30.png`. `ui/hearts.png` is a 32×32 spritesheet, 3 frames: 0 = empty, 1 = half, 2 = full. `ui/gunContainer.png` is a single 231×128 image. Roll animations from `playerRolls.json` (legacy indices resolved): see Task 8's table.
- **Legacy feed strings (port verbatim):** `` `${killer} has slain ${victim}` ``, `` `${name} has advanced to Gun Level: ${n}` ``, `` `${name} has taken ${place} place` `` (place ∈ 1st/2nd/3rd/4th). Win line (legacy had none — invented): `` `${name} has won the game!` ``.
- **Map/grid facts (verified against `client/public/assets/maps/main.json`):** player grid (union of collision layers) = 411 solid tiles; **bullet grid (`wallCollision` only) = 285**; `waterCollision` is empty, `litWallCollision` adds 133 (7 overlap). Spawn pairs with bullet line-of-sight (4 px raycast, verified): **(128,128)↔(992,128)**, **(384,416)↔(224,704)**, **(96,992)↔(992,992)**. Combat tests and the E2E position players on the (384,416)↔(224,704) pair.
- **Clocks:** all timing fields (`reloadStartedAt`, `immuneUntil`, fire gates) are **server** `Date.now()` values, compared only server-side. The client NEVER compares its clock to them: the reload bar is driven by the locally-observed `reloadStartedAt` 0→nonzero transition; the immunity tint by the hp <100→100 transition. The active-reload window already carries ±50 ms slack for the RTT/2 skew this introduces.
- **Test seams:** `MSG_END_GAME` (existing) and `MSG_DEV_TELEPORT` (new, Task 7) are dev/test messages, same trust class. They bypass gameplay rules deliberately; the room is friends-only at prototype tier. Room tests may also write `room.state` directly server-side (positions, hp) — that's the @colyseus/testing pattern.
- Room tests wait out the real 3 s countdown (`setTimeout 3300`) — reuse the `startedGame()` pattern from `arenaMovement.test.ts`. Active-reload tests use real sleeps; the suite is slow by design.
- Colyseus schema callbacks are **callable** in 2.0.37 and return a detach fn — cast `as unknown as () => void` like the existing `ArenaScene` code. `state.listen("prop", cb)` is also callable.
- Run a single test file with `pnpm -C server exec vitest run src/__tests__/<file>.test.ts`.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `client/package.json` | Modify | colyseus.js → 0.15.28 |
| `client/public/assets/images/*`, `.../sounds/*` | Create (copy) | Gun/UI atlases, 4A sounds |
| `shared/src/tuning.ts` | Modify | Gun ladder, combat constants |
| `shared/src/messages.ts` | Modify | `"ended"` phase, input extension, fire/reload/teleport messages, EVT types |
| `shared/src/move.ts` | Modify | `PlayerSim`, roll FSM, `stepPlayer(grid, sim, input)` |
| `shared/src/prediction.ts` | Create | `LocalPrediction` (moved from client, sim-threaded) |
| `shared/src/grid.ts` | Modify | Optional layer-name filter (bullet grid) |
| `shared/src/index.ts` | Modify | Export prediction |
| `server/src/schema/ArenaState.ts` | Modify | Sim + combat fields, `Bullet`, `winnerName`, `tick` |
| `server/src/rooms/ArenaRoom.ts` | Modify | Sim threading, combat commands, bullet tick, kills, win FSM |
| `server/src/sim/collision.ts` | Modify | `loadBulletGrid()` |
| `server/src/sim/bullets.ts` | Create | Substepped bullet integration + hit detection |
| `server/src/__tests__/guns.test.ts` | Create | Ladder table resolution |
| `server/src/__tests__/move.test.ts` | Modify | `stepPlayer` rewrite + roll FSM cases |
| `server/src/__tests__/simParity.test.ts` | Create | Server ↔ prediction parity (the stage's regression net) |
| `server/src/__tests__/bullets.test.ts` | Create | Substeps, tunneling guard, hits, lifetime |
| `server/src/__tests__/grid.test.ts` | Modify | Bullet-grid filter cases |
| `server/src/__tests__/arenaCombat.test.ts` | Create | Fire gates, reload, kills, respawn, win FSM |
| `client/src/lobby/arenaState.ts` | Modify | Mirror new fields, bullets, `listen` |
| `client/src/lobby/useArenaRoom.ts` | Modify | Targeted-listener sync (no 20 Hz React churn) |
| `client/src/App.tsx` | Modify | GameMount stays mounted on `"ended"` |
| `client/src/game/net/prediction.ts` | Delete | Moved to shared |
| `client/src/game/animations.ts` | Modify | Roll animations |
| `client/src/game/scenes/ArenaScene.ts` | Modify | Aim/fire/reload/roll input, guns, crosshair, bullets, tint, E2E hooks |
| `client/src/game/hud.ts` | Create | Hearts, ammo, medal, reload bar, feed, banner |
| `tests/combat.spec.ts` | Create | Two-client combat E2E |
| `docs/PROGRESS.md` | Modify | 4A shipped entry |

---

### Task 1: Branch + Colyseus client alignment

**Files:**
- Modify: `client/package.json`

CLAUDE.md mandates aligning client/server Colyseus lines before wire-protocol work. Server is `0.15.57`; the latest client lib on the 0.15 line is `colyseus.js@0.15.28` (verified on npm). Both must keep resolving `@colyseus/schema@2.0.37`.

- [ ] **Step 1: Check out the branch**

```bash
cd /Users/qcharlieshi/dev/genzed
git checkout stage-4a-combat
```

- [ ] **Step 2: Bump colyseus.js**

```bash
pnpm -C client add colyseus.js@0.15.28
```

- [ ] **Step 3: Verify the schema resolution is still 2.0.37 (single version)**

Run: `pnpm why @colyseus/schema | grep @colyseus/schema`
Expected: only `2.0.37` appears (from both `colyseus.js` and the server packages).

- [ ] **Step 4: Full gates + E2E smoke (wire-protocol regression)**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green — movement E2E proves join/state-sync still works on the bumped client.

- [ ] **Step 5: Commit**

```bash
git add client/package.json pnpm-lock.yaml
git commit -m "chore(client): align colyseus.js to 0.15.28 (server 0.15.57 line, schema 2.0.37)"
```

---

### Task 2: Copy 4A assets

**Files (all Create, copied verbatim from `legacy/client/assets/`):**
- `client/public/assets/images/finalGunSheet.png` + `.json`
- `client/public/assets/images/crosshair.png` + `.json`
- `client/public/assets/images/medals.png` + `.json`
- `client/public/assets/images/reloadBar.png` + `.json`
- `client/public/assets/images/ui/hearts.png`, `client/public/assets/images/ui/gunContainer.png`
- `client/public/assets/sounds/`: `heavyPistol.wav`, `pistolReload.mp3`, `reloadSuccess.wav`, `reloadFail.wav`, `playerHurt.wav`, `levelUp.wav`, `gameWin.wav`, `themeLoop.wav`

Do **not** copy `updatedGunSheet`, `finalSheet`, `gunAndBulletTest`, `shoot.ogg` (dead experiments / never played). Zombie assets, `heart.png`, `speed.png`, `zombie.wav`, `zombieHit.wav` are 4B.

- [ ] **Step 1: Copy**

```bash
cd /Users/qcharlieshi/dev/genzed
mkdir -p client/public/assets/images/ui client/public/assets/sounds
cp legacy/client/assets/images/finalGunSheet.{png,json} client/public/assets/images/
cp legacy/client/assets/images/crosshair.{png,json} client/public/assets/images/
cp legacy/client/assets/images/medals.{png,json} client/public/assets/images/
cp legacy/client/assets/images/reloadBar.{png,json} client/public/assets/images/
cp legacy/client/assets/images/ui/hearts.png legacy/client/assets/images/ui/gunContainer.png client/public/assets/images/ui/
cp legacy/client/assets/sounds/{heavyPistol.wav,pistolReload.mp3,reloadSuccess.wav,reloadFail.wav,playerHurt.wav,levelUp.wav,gameWin.wav,themeLoop.wav} client/public/assets/sounds/
```

- [ ] **Step 2: Verify**

Run: `ls client/public/assets/images client/public/assets/images/ui client/public/assets/sounds`
Expected: 8 image files + 2 ui files + 8 sound files (alongside the Stage 3 assets).

- [ ] **Step 3: Commit**

```bash
git add client/public/assets
git commit -m "feat(client): copy legacy gun/UI atlases and combat sounds verbatim"
```

---

### Task 3: Shared combat tuning + message constants — TDD on the gun table

**Files:**
- Modify: `shared/src/tuning.ts`
- Modify: `shared/src/messages.ts`
- Test: `server/src/__tests__/guns.test.ts`

The `GUNS` table is the cumulative resolution of legacy's upgrade deltas — the test pins every cell so a transcription slip can't ship. `InputMessage` is NOT touched here (that lands with the sim refactor in Task 4 so each task stays green).

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/guns.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { GUNS, gunForLevel, WIN_GUN_LEVEL } from "@genzed/shared";

// Spec "Gun ladder" table — cumulative values resolved from legacy upgrade deltas.
const EXPECTED = [
  { name: "pistol", damage: 10, fireIntervalMs: 350, clip: 10, bulletSpeed: 500, bulletLifetimeMs: 0 },
  { name: "smg", damage: 5, fireIntervalMs: 150, clip: 30, bulletSpeed: 500, bulletLifetimeMs: 0 },
  { name: "sniper", damage: 70, fireIntervalMs: 1050, clip: 5, bulletSpeed: 1000, bulletLifetimeMs: 0 },
  { name: "heavy", damage: 90, fireIntervalMs: 1550, clip: 2, bulletSpeed: 200, bulletLifetimeMs: 0 },
  { name: "melee", damage: 70, fireIntervalMs: 350, clip: -1, bulletSpeed: 200, bulletLifetimeMs: 50 },
];

describe("gun ladder", () => {
  it("has 5 weapons; level 6 is the win state", () => {
    expect(GUNS).toHaveLength(5);
    expect(WIN_GUN_LEVEL).toBe(6);
  });

  it("matches the spec table cell-for-cell", () => {
    EXPECTED.forEach((e, i) => {
      const g = GUNS[i];
      if (!g) throw new Error(`missing gun ${i}`);
      expect(g).toMatchObject(e);
    });
  });

  it("gunForLevel indexes by level and clamps the win level to the last weapon", () => {
    expect(gunForLevel(1).name).toBe("pistol");
    expect(gunForLevel(5).name).toBe("melee");
    expect(gunForLevel(6).name).toBe("melee"); // hasWon — phase ends, but never throws
  });

  it("uses real atlas frame names", () => {
    expect(gunForLevel(1).gunFrame).toBe("pistol.png");
    expect(gunForLevel(1).bulletFrame).toBe("pistolBullet.png");
    expect(gunForLevel(2).gunFrame).toBe("ak5 (1).png");
    expect(gunForLevel(2).bulletFrame).toBe("New Piskel (11).png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/guns.test.ts`
Expected: FAIL — `GUNS` is not exported from `@genzed/shared`.

- [ ] **Step 3: Append to `shared/src/tuning.ts`**

```ts
// === Stage 4A: combat (spec docs/superpowers/specs/2026-06-11-stage4-combat-design.md) ===

export type GunSpec = {
  name: string;
  damage: number;
  fireIntervalMs: number;
  clip: number; // -1 = infinite (L5)
  bulletSpeed: number; // px/s
  bulletLifetimeMs: number; // 0 = lives until wall/world hit
  gunFrame: string; // finalGunSheet atlas frame
  bulletFrame: string;
};

// Cumulative gun ladder resolved from legacy upgrade deltas. Index = gunLevel - 1.
// Level 6 is the win state, not a weapon.
export const GUNS: readonly GunSpec[] = [
  { name: "pistol", damage: 10, fireIntervalMs: 350, clip: 10, bulletSpeed: 500, bulletLifetimeMs: 0, gunFrame: "pistol.png", bulletFrame: "pistolBullet.png" },
  { name: "smg", damage: 5, fireIntervalMs: 150, clip: 30, bulletSpeed: 500, bulletLifetimeMs: 0, gunFrame: "ak5 (1).png", bulletFrame: "New Piskel (11).png" },
  { name: "sniper", damage: 70, fireIntervalMs: 1050, clip: 5, bulletSpeed: 1000, bulletLifetimeMs: 0, gunFrame: "New Piskel (15).png", bulletFrame: "New Piskel (16).png" },
  { name: "heavy", damage: 90, fireIntervalMs: 1550, clip: 2, bulletSpeed: 200, bulletLifetimeMs: 0, gunFrame: "New Piskel (17).png", bulletFrame: "New Piskel (17).png" },
  { name: "melee", damage: 70, fireIntervalMs: 350, clip: -1, bulletSpeed: 200, bulletLifetimeMs: 50, gunFrame: "New Piskel (6).png", bulletFrame: "New Piskel (6).png" },
];

export const WIN_GUN_LEVEL = 6;
export const GUN_L5_SPEED_BONUS = 36; // px/s, applied as Player.speedBonus at level 5

export function gunForLevel(level: number): GunSpec {
  const g = GUNS[Math.min(Math.max(level, 1), GUNS.length) - 1];
  if (!g) throw new Error(`no gun for level ${level}`);
  return g;
}

export const PLAYER_HEALTH = 100;
export const RESPAWN_IMMUNITY_MS = 1000;

export const ROLL_SPEED_BONUS = 100; // px/s on top of effective speed, roll direction only
export const ROLL_DURATION_TICKS = 12; // 600 ms at 20 Hz
export const ROLL_COOLDOWN_TICKS = 20; // 1000 ms, measured from roll start

export const RELOAD_MS = 2000;
export const ACTIVE_RELOAD_WINDOW_MS: readonly [number, number] = [1350, 1650];
export const ACTIVE_RELOAD_DAMAGE_BONUS = 10;
export const ACTIVE_RELOAD_BONUS_MS = 2500;
export const RELOAD_JAM_TOTAL_MS = 3500; // jam: reload completes at attempt + this

export const BULLET_SUBSTEP_PX = 16;
export const WIN_BANNER_MS = 10_000; // "ended" → lobby reset delay
```

- [ ] **Step 4: Update `shared/src/messages.ts`** (full new content — adds `"ended"`, command + event types; `InputMessage` unchanged until Task 4)

```ts
export const MSG_START_GAME = "start_game";
export const MSG_END_GAME = "end_game";

export const CODE_GAME_IN_PROGRESS = 4001;
export const CODE_LOBBY_FULL = 4003;

export type Phase = "lobby" | "starting" | "playing" | "ended";

export const MSG_INPUT = "input";

export type InputMessage = {
  seq: number; // monotonic per client, starts at 1
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

// --- Stage 4A combat commands (server-gated, bypass the per-tick input cap) ---

export const MSG_FIRE = "fire";
export type FireMessage = { tx: number; ty: number }; // world point; bullets converge on it

export const MSG_RELOAD = "reload";
export const MSG_ACTIVE_RELOAD = "active_reload";

// Dev/test seam, same trust class as MSG_END_GAME (single friends-only lobby).
export const MSG_DEV_TELEPORT = "dev_teleport";
export type DevTeleportMessage = { x: number; y: number };

// --- Stage 4A broadcasts / targeted events ---

export const EVT_SHOT = "shot";
export type ShotEvent = { shooterId: string; level: number; x: number; y: number };

export const EVT_LOG = "log";
export type LogKind = "slain" | "levelup" | "rank" | "win" | "pickup";
export type LogEvent = { kind: LogKind; text: string };

// Sent to the reloading client only (spec addendum: success can't be derived
// from schema without racing normal completion; jam/success need instant FX).
export const EVT_RELOAD_RESULT = "reload_result";
export type ReloadResultEvent = { ok: boolean };
```

- [ ] **Step 5: Build shared, run test to verify it passes**

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/guns.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Full gates (regression — `"ended"` widens the Phase union; nothing narrows it)**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add shared/src server/src/__tests__/guns.test.ts
git commit -m "feat(shared): gun ladder, combat tuning, and combat message contracts"
```

---

### Task 4: Sim-state refactor — roll FSM through ONE simulation + parity test

**Files:**
- Modify: `shared/src/move.ts`
- Create: `shared/src/prediction.ts` (LocalPrediction moves here from the client)
- Modify: `shared/src/messages.ts` (extend `InputMessage`)
- Modify: `shared/src/index.ts`
- Modify: `server/src/schema/ArenaState.ts` (the four sim fields only)
- Modify: `server/src/rooms/ArenaRoom.ts` (tick threading + validation)
- Modify: `client/src/lobby/arenaState.ts` (mirror sim fields)
- Modify: `client/src/game/scenes/ArenaScene.ts` (sim-based prediction, SPACE roll, aimAngle send)
- Delete: `client/src/game/net/prediction.ts`
- Modify+Test: `server/src/__tests__/move.test.ts` (stepPlayer rewrite + roll FSM)
- Test: `server/src/__tests__/simParity.test.ts`

**This is the stage's hard kernel (spec risk #1) — land it before any combat consumes it.** `stepPlayer` becomes `(grid, sim, input) → { sim, vx, vy }` where `sim = { x, y, dir, rollTicksLeft, rollDirMask, rollCooldownTicks, speedBonus }`. Server tick and client prediction/replay run the identical function; reconciliation rebases the **full sim** from schema and replays pending inputs. Roll direction is stored as the 4-bit input mask held at roll start (encodes diagonals; `velocityFromInput` gives "(base+bonus) then ×0.7071 per axis" for free — spec deviation 5). No movement keys (or cancelled keys) at roll start → roll toward facing.

- [ ] **Step 1: Rewrite the `stepPlayer` block of `server/src/__tests__/move.test.ts`**

Replace the entire `describe("stepPlayer (one 50 ms tick)", ...)` block with the following (keep the `velocityFromInput` and `move` describes untouched; add the new imports to the existing import list):

```ts
// ADD to the @genzed/shared import list at the top of the file:
//   stepPlayer is already imported; add:
//   DIR_DOWN, DIR_UP, DIR_LEFT, ROLL_SPEED_BONUS, ROLL_DURATION_TICKS, ROLL_COOLDOWN_TICKS,
//   inputMask, type PlayerSim, type SimInput

function sim(x: number, y: number, extra: Partial<PlayerSim> = {}): PlayerSim {
  return {
    x, y, dir: DIR_DOWN,
    rollTicksLeft: 0, rollDirMask: 0, rollCooldownTicks: 0, speedBonus: 0,
    ...extra,
  };
}

const IDLE_SIM: SimInput = { up: false, down: false, left: false, right: false, roll: false };

describe("stepPlayer (one 50 ms tick, sim-state)", () => {
  it("advances 5 px per tick at PLAYER_SPEED and reports velocity", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, sim(80, 80), { ...IDLE_SIM, right: true });
    expect(r.sim.x).toBeCloseTo(85, 6);
    expect(r.sim.y).toBe(80);
    expect(r.vx).toBe(PLAYER_SPEED);
    expect(r.vy).toBe(0);
  });

  it("applies speedBonus to walking", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, sim(80, 80, { speedBonus: 36 }), { ...IDLE_SIM, right: true });
    expect(r.sim.x).toBeCloseTo(80 + 136 * 0.05, 4);
  });

  it("updates facing from velocity and keeps it when idle", () => {
    const g = makeGrid(10, 10);
    const moved = stepPlayer(g, sim(80, 80), { ...IDLE_SIM, up: true });
    expect(moved.sim.dir).toBe(DIR_UP);
    const idle = stepPlayer(g, moved.sim, IDLE_SIM);
    expect(idle.sim.dir).toBe(DIR_UP);
  });

  it("does not mutate the input sim", () => {
    const g = makeGrid(10, 10);
    const before = sim(80, 80);
    stepPlayer(g, before, { ...IDLE_SIM, right: true });
    expect(before.x).toBe(80);
  });
});

describe("roll FSM", () => {
  it("starts a roll: 12 ticks at base+ROLL_SPEED_BONUS in the held direction", () => {
    const g = makeGrid(20, 20);
    const r = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true });
    expect(r.sim.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 1); // start tick consumed one
    expect(r.sim.rollDirMask).toBe(inputMask({ up: false, down: false, left: false, right: true }));
    expect(r.sim.rollCooldownTicks).toBe(ROLL_COOLDOWN_TICKS);
    expect(r.sim.x).toBeCloseTo(160 + (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4); // 10 px
  });

  it("normalizes diagonal rolls AFTER adding the bonus (spec deviation 5)", () => {
    const g = makeGrid(20, 20);
    const r = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true, down: true });
    const perAxis = (PLAYER_SPEED + ROLL_SPEED_BONUS) * DIAGONAL_FACTOR * 0.05;
    expect(r.sim.x).toBeCloseTo(160 + perAxis, 4);
    expect(r.sim.y).toBeCloseTo(160 + perAxis, 4);
  });

  it("ignores movement keys mid-roll (velocity locked to the roll vector)", () => {
    const g = makeGrid(20, 20);
    let s = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true }).sim;
    const xAfterStart = s.x;
    s = stepPlayer(g, s, { ...IDLE_SIM, left: true }).sim; // opposing key — ignored
    expect(s.x).toBeCloseTo(xAfterStart + (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
    expect(s.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 2);
  });

  it("rolls toward facing when no movement keys (or cancelled keys) are held", () => {
    const g = makeGrid(20, 20);
    const fromFacing = stepPlayer(g, sim(160, 160, { dir: DIR_UP }), { ...IDLE_SIM, roll: true });
    expect(fromFacing.sim.y).toBeCloseTo(160 - (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
    const cancelled = stepPlayer(g, sim(160, 160, { dir: DIR_LEFT }), { ...IDLE_SIM, roll: true, up: true, down: true });
    expect(cancelled.sim.x).toBeCloseTo(160 - (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
  });

  it("enforces the cooldown from roll START (re-roll possible exactly 20 ticks later)", () => {
    const g = makeGrid(20, 20);
    let s = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true }).sim; // tick 0
    for (let t = 1; t < ROLL_COOLDOWN_TICKS; t += 1) {
      s = stepPlayer(g, s, { ...IDLE_SIM, roll: true }).sim; // spamming roll — all ignored
      expect(s.rollDirMask).toBe(8); // still the original roll's mask
    }
    expect(s.rollTicksLeft).toBe(0); // roll itself ended after 12 ticks
    // 19 decrements have run (ticks 1..19) → cd = 1. The 20th call decrements
    // it to 0 and THEN checks the gate, so the re-roll lands exactly at tick 20.
    expect(s.rollCooldownTicks).toBe(1);
    s = stepPlayer(g, s, { ...IDLE_SIM, roll: true, up: true }).sim; // tick 20 — allowed
    expect(s.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 1);
    expect(s.rollDirMask).toBe(1);
  });

  it("a roll into a wall stops flush and keeps ticking", () => {
    // Solid tile (3,2) spans x [96,128); start at (80,80): right edge stops at 88.
    const g = makeGrid(10, 10, [[3, 2]]);
    let s = sim(80, 80);
    for (let t = 0; t < ROLL_DURATION_TICKS; t += 1) {
      s = stepPlayer(g, s, t === 0 ? { ...IDLE_SIM, roll: true, right: true } : IDLE_SIM).sim;
    }
    expect(s.x).toBeCloseTo(88, 1);
    expect(s.rollTicksLeft).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/move.test.ts`
Expected: FAIL — compile errors (`PlayerSim`/`SimInput`/`inputMask` not exported; `stepPlayer` signature mismatch).

- [ ] **Step 3: Rewrite `shared/src/move.ts`** (full new content)

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
  DIR_DOWN,
  DIR_UP,
  DIR_LEFT,
  DIR_RIGHT,
  ROLL_SPEED_BONUS,
  ROLL_DURATION_TICKS,
  ROLL_COOLDOWN_TICKS,
} from "./tuning.js";
import { isSolidTile, type SolidityGrid } from "./grid.js";

export type MoveInput = { up: boolean; down: boolean; left: boolean; right: boolean };
export type SimInput = MoveInput & { roll: boolean };

// The complete per-player simulation state. Server tick and client
// prediction/replay both run stepPlayer over this — ONE simulation.
// Every field here must exist on the Player schema so reconcile can rebase.
export type PlayerSim = {
  x: number;
  y: number;
  dir: number; // DIR_* facing
  rollTicksLeft: number;
  rollDirMask: number; // input mask held at roll start (encodes diagonals)
  rollCooldownTicks: number;
  speedBonus: number; // 0 | 36 (L5) — +100 speed pickup arrives in 4B
};

const HW = PLAYER_W / 2;
const HH = PLAYER_H / 2;
const EPS = 1e-3;

// bit0 up, bit1 down, bit2 left, bit3 right
export function inputMask(i: MoveInput): number {
  return (i.up ? 1 : 0) | (i.down ? 2 : 0) | (i.left ? 4 : 0) | (i.right ? 8 : 0);
}

export function maskInput(mask: number): MoveInput {
  return {
    up: (mask & 1) !== 0,
    down: (mask & 2) !== 0,
    left: (mask & 4) !== 0,
    right: (mask & 8) !== 0,
  };
}

function maskFromDir(dir: number): number {
  return dir === DIR_UP ? 1 : dir === DIR_DOWN ? 2 : dir === DIR_LEFT ? 4 : 8;
}

export function velocityFromInput(input: MoveInput, speed = PLAYER_SPEED): { vx: number; vy: number } {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const factor = dx !== 0 && dy !== 0 ? DIAGONAL_FACTOR : 1;
  return { vx: dx * speed * factor, vy: dy * speed * factor };
}

function sweepX(grid: SolidityGrid, x: number, y: number, dx: number): number {
  if (dx === 0) return x;
  const newX = x + dx;
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
  const newY = y + dy;
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
// world-bounds clamp. Precondition: |dxPx| and |dyPx| < TILE_SIZE per call — max
// roll speed is (100+36+100) px/s × 50 ms = 11.8 px/tick.
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
// server's authoritative loop and the client's prediction/replay. Pure: returns
// a new sim, never mutates the argument.
export function stepPlayer(
  grid: SolidityGrid,
  sim: PlayerSim,
  input: SimInput,
): { sim: PlayerSim; vx: number; vy: number } {
  const next: PlayerSim = { ...sim };

  if (next.rollCooldownTicks > 0) next.rollCooldownTicks -= 1;

  if (input.roll && next.rollTicksLeft === 0 && next.rollCooldownTicks === 0) {
    let mask = inputMask(input);
    const net = velocityFromInput(maskInput(mask));
    if (net.vx === 0 && net.vy === 0) mask = maskFromDir(next.dir); // no/cancelled keys: roll toward facing
    next.rollDirMask = mask;
    next.rollTicksLeft = ROLL_DURATION_TICKS;
    next.rollCooldownTicks = ROLL_COOLDOWN_TICKS;
  }

  let vx: number;
  let vy: number;
  if (next.rollTicksLeft > 0) {
    // Mid-roll: movement keys ignored, velocity locked to the roll vector.
    next.rollTicksLeft -= 1;
    const v = velocityFromInput(
      maskInput(next.rollDirMask),
      PLAYER_SPEED + next.speedBonus + ROLL_SPEED_BONUS,
    );
    vx = v.vx;
    vy = v.vy;
  } else {
    const v = velocityFromInput(input, PLAYER_SPEED + next.speedBonus);
    vx = v.vx;
    vy = v.vy;
  }

  const dt = TICK_MS / 1000;
  const pos = move(grid, next.x, next.y, vx * dt, vy * dt);
  next.x = pos.x;
  next.y = pos.y;
  if (vx !== 0 || vy !== 0) {
    // Horizontal wins on diagonals; facing persists when idle.
    next.dir = vx > 0 ? DIR_RIGHT : vx < 0 ? DIR_LEFT : vy > 0 ? DIR_DOWN : DIR_UP;
  }
  return { sim: next, vx, vy };
}
```

- [ ] **Step 4: Extend `InputMessage` in `shared/src/messages.ts`**

Replace the `InputMessage` type with:

```ts
export type InputMessage = {
  seq: number; // monotonic per client, starts at 1
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  roll: boolean; // rides the seq'd, replay-guarded, prediction-replayed channel
  aimAngle: number; // radians; NOT predicted — server applies, remotes render
};
```

- [ ] **Step 5: Create `shared/src/prediction.ts`** (moved from `client/src/game/net/prediction.ts`, sim-threaded)

```ts
import { stepPlayer, type PlayerSim, type SimInput } from "./move.js";
import type { InputMessage } from "./messages.js";
import type { SolidityGrid } from "./grid.js";

// Client-side prediction for the local player; lives in shared so the parity
// test can drive it against the server path. Reconcile rebases the FULL sim
// from the server's authoritative schema and replays unacked inputs —
// identical math both sides, so corrections only fire on packet loss/reorder.
export class LocalPrediction {
  sim: PlayerSim;
  private pending: InputMessage[] = [];
  private nextSeq: number;

  // nextSeq must continue from the server's lastProcessedInput + 1 — on a
  // mid-game reconnect the server has already acked earlier seqs.
  constructor(
    sim: PlayerSim,
    private grid: SolidityGrid,
    nextSeq = 1,
  ) {
    this.sim = sim;
    this.nextSeq = nextSeq;
  }

  get x(): number {
    return this.sim.x;
  }

  get y(): number {
    return this.sim.y;
  }

  // Sample one 20 Hz input: apply locally, queue for reconciliation, return the
  // message to send. aimAngle is carried, not simulated.
  sample(input: SimInput, aimAngle: number): InputMessage {
    const msg: InputMessage = { ...input, seq: this.nextSeq, aimAngle };
    this.nextSeq += 1;
    this.pending.push(msg);
    this.sim = stepPlayer(this.grid, this.sim, msg).sim;
    return msg;
  }

  reconcile(serverSim: PlayerSim, lastProcessedInput: number): void {
    this.pending = this.pending.filter((p) => p.seq > lastProcessedInput);
    let sim = serverSim;
    for (const p of this.pending) {
      sim = stepPlayer(this.grid, sim, p).sim;
    }
    this.sim = sim;
  }
}
```

Note: `stepPlayer`'s `input` parameter accepts an `InputMessage` structurally (`SimInput` + extra fields), and `messages.ts` must not import from `prediction.ts` — the dependency points one way.

- [ ] **Step 6: Export from `shared/src/index.ts`** (add line)

```ts
export * from "./prediction.js";
```

- [ ] **Step 7: Add the four sim fields to `Player` in `server/src/schema/ArenaState.ts`**

Add to the `Player` class:

```ts
  @type("uint8") rollTicksLeft = 0;
  @type("uint8") rollDirMask = 0;
  @type("uint8") rollCooldownTicks = 0;
  @type("uint8") speedBonus = 0;
```

- [ ] **Step 8: Thread the sim through `server/src/rooms/ArenaRoom.ts`**

Five edits:

(a) Extend `isInputMessage` — add to the returned conjunction:

```ts
    typeof o.roll === "boolean" &&
    typeof o.aimAngle === "number" &&
    Number.isFinite(o.aimAngle) &&
```

(b) Add a private helper to the class:

```ts
  private simFromPlayer(player: Player): import("@genzed/shared").PlayerSim {
    return {
      x: player.x,
      y: player.y,
      dir: player.dir,
      rollTicksLeft: player.rollTicksLeft,
      rollDirMask: player.rollDirMask,
      rollCooldownTicks: player.rollCooldownTicks,
      speedBonus: player.speedBonus,
    };
  }
```

(Import `type PlayerSim` from `@genzed/shared` and write the return type as `PlayerSim` — the inline `import()` above is just to show the type's origin.)

(c) Replace the input-application loop body in `tick()` (the `for (const input of batch)` block) with:

```ts
      for (const input of batch) {
        if (input.seq <= player.lastProcessedInput) continue; // dup/replay guard
        const r = stepPlayer(this.grid, this.simFromPlayer(player), input);
        player.x = r.sim.x;
        player.y = r.sim.y;
        player.dir = r.sim.dir;
        player.rollTicksLeft = r.sim.rollTicksLeft;
        player.rollDirMask = r.sim.rollDirMask;
        player.rollCooldownTicks = r.sim.rollCooldownTicks;
        player.vx = r.vx;
        player.vy = r.vy;
        player.lastProcessedInput = input.seq;
      }
```

(The old `player.dir` ternary is gone — `stepPlayer` owns facing now.)

(d) In `assignSpawns()`, after `player.lastProcessedInput = 0;` add:

```ts
      player.rollTicksLeft = 0;
      player.rollDirMask = 0;
      player.rollCooldownTicks = 0;
      player.speedBonus = 0;
```

(e) Prune the now-unused imports: `stepPlayer` no longer needs the room to compute facing, so drop `DIR_UP`, `DIR_LEFT`, `DIR_RIGHT` from the `@genzed/shared` import (keep `DIR_DOWN` — `assignSpawns` uses it). `no-unused-vars` is an error in the flat config; the lint gate fails otherwise.

- [ ] **Step 9: Mirror the sim fields in `client/src/lobby/arenaState.ts`**

Add to `LobbyPlayer`:

```ts
  rollTicksLeft: number;
  rollDirMask: number;
  rollCooldownTicks: number;
  speedBonus: number;
```

- [ ] **Step 10: Rewire `client/src/game/scenes/ArenaScene.ts` and delete the old prediction module**

```bash
rm client/src/game/net/prediction.ts
```

Edits to `ArenaScene.ts`:

(a) Import `LocalPrediction`, `type PlayerSim`, `type SimInput` from `@genzed/shared` (drop the `../net/prediction.js` import and the now-unused `MoveInput` import).

(b) Add a module-level helper above the class:

```ts
function simFromPlayer(p: LobbyPlayer): PlayerSim {
  return {
    x: p.x,
    y: p.y,
    dir: p.dir,
    rollTicksLeft: p.rollTicksLeft,
    rollDirMask: p.rollDirMask,
    rollCooldownTicks: p.rollCooldownTicks,
    speedBonus: p.speedBonus,
  };
}
```

(c) Add SPACE to the key map — replace the `keys` field declaration and assignment:

```ts
  private keys!: Record<"W" | "A" | "S" | "D" | "SPACE", Phaser.Input.Keyboard.Key>;
```

```ts
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE") as ArenaScene["keys"];
```

(d) In `addPlayer`, replace the local-player prediction wiring:

```ts
      this.prediction = new LocalPrediction(simFromPlayer(player), this.grid, player.lastProcessedInput + 1);
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      const unsubscribe = player.onChange(() => {
        this.prediction?.reconcile(simFromPlayer(player), player.lastProcessedInput);
      }) as unknown as () => void;
```

(e) Replace `sampleInput()`:

```ts
  private sampleInput(): void {
    if (!this.prediction) return;
    const input: SimInput = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
      roll: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
    };
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    const aimAngle = Math.atan2(pointer.worldY - this.prediction.y, pointer.worldX - this.prediction.x);
    const msg = this.prediction.sample(input, aimAngle);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);
  }
```

(`updateLocalAnimation(input)` still takes the same shape — `SimInput` extends `MoveInput`; change its parameter type to `SimInput` if tsc complains. Roll *animation* lands in Task 8; this task is about correct movement.)

- [ ] **Step 11: Build shared, run move tests**

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/move.test.ts`
Expected: all passing (old `velocityFromInput`/`move` cases + new stepPlayer/roll cases).

- [ ] **Step 12: Write the parity test** — `server/src/__tests__/simParity.test.ts`

This is the stage's regression net: identical input streams through (a) the server path — schema-field round-trip per input, exactly what `ArenaRoom.tick` does — and (b) `LocalPrediction` with reconciles injected at varying cadence, including mid-roll. Exact float equality, real arena grid.

```ts
import { describe, it, expect } from "vitest";
import {
  stepPlayer,
  LocalPrediction,
  SPAWN_POINTS,
  DIR_DOWN,
  type InputMessage,
  type PlayerSim,
} from "@genzed/shared";
import { loadSolidityGrid } from "../sim/collision.js";

const grid = loadSolidityGrid();

function freshSim(): PlayerSim {
  const p = SPAWN_POINTS[2]; // (384, 416) — verified open floor
  if (!p) throw new Error("spawn missing");
  return { x: p.x, y: p.y, dir: DIR_DOWN, rollTicksLeft: 0, rollDirMask: 0, rollCooldownTicks: 0, speedBonus: 0 };
}

// The server path: a fresh sim object is built from schema fields for every
// input and the result written back (ArenaRoom.tick's exact dataflow).
class ServerSide {
  sim = freshSim();
  apply(input: InputMessage): void {
    this.sim = { ...stepPlayer(grid, { ...this.sim }, input).sim };
  }
}

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(seq: number, rnd: () => number): InputMessage {
  return {
    seq,
    up: rnd() < 0.3,
    down: rnd() < 0.3,
    left: rnd() < 0.3,
    right: rnd() < 0.3,
    roll: rnd() < 0.08,
    aimAngle: rnd() * Math.PI * 2 - Math.PI,
  };
}

describe("server/prediction sim parity (the ONE-simulation invariant)", () => {
  for (const reconcileEvery of [1, 3, 7]) {
    it(`stays exact over 400 random inputs, reconciling every ${reconcileEvery}`, () => {
      const rnd = mulberry32(42);
      const server = new ServerSide();
      const prediction = new LocalPrediction(freshSim(), grid, 1);
      for (let seq = 1; seq <= 400; seq += 1) {
        const input = randomInput(seq, rnd);
        const sent = prediction.sample(input, input.aimAngle);
        expect(sent.seq).toBe(seq);
        server.apply(sent);
        if (seq % reconcileEvery === 0) {
          prediction.reconcile({ ...server.sim }, seq);
          expect(prediction.x).toBe(server.sim.x);
          expect(prediction.y).toBe(server.sim.y);
        }
      }
      expect(prediction.sim).toEqual(server.sim);
    });
  }

  it("replays pending inputs exactly across a lagged ack (10 inputs behind)", () => {
    const rnd = mulberry32(7);
    const server = new ServerSide();
    const prediction = new LocalPrediction(freshSim(), grid, 1);
    const history: PlayerSim[] = [];
    for (let seq = 1; seq <= 60; seq += 1) {
      const input = randomInput(seq, rnd);
      prediction.sample(input, input.aimAngle);
      server.apply(input);
      history.push({ ...server.sim });
    }
    const ack = history[49]; // server state as of seq 50
    if (!ack) throw new Error("history missing");
    prediction.reconcile({ ...ack }, 50); // replay 51..60 on top
    expect(prediction.x).toBe(server.sim.x);
    expect(prediction.y).toBe(server.sim.y);
  });

  it("survives reconciles landing mid-roll", () => {
    const NO = { up: false, down: false, left: false, right: false, roll: false, aimAngle: 0 };
    const server = new ServerSide();
    const prediction = new LocalPrediction(freshSim(), grid, 1);
    const script = [
      { ...NO, roll: true, left: true }, // roll left
      ...Array.from({ length: 14 }, () => ({ ...NO, left: true })),
      { ...NO, roll: true, up: true }, // still cooling down — must be ignored identically
      ...Array.from({ length: 10 }, () => NO),
      { ...NO, roll: true, up: true, down: true }, // cancelled keys → facing roll
      ...Array.from({ length: 15 }, () => NO),
    ];
    script.forEach((partial, i) => {
      const seq = i + 1;
      const input: InputMessage = { ...partial, seq };
      prediction.sample(input, input.aimAngle);
      server.apply(input);
      if (seq === 5 || seq === 17 || seq === 30) {
        prediction.reconcile({ ...server.sim }, seq); // mid-roll, mid-cooldown, mid-third-roll
        expect(prediction.sim).toEqual(server.sim);
      }
    });
    prediction.reconcile({ ...server.sim }, script.length);
    expect(prediction.sim).toEqual(server.sim);
  });
});
```

- [ ] **Step 13: Run the parity test**

Run: `pnpm -C server exec vitest run src/__tests__/simParity.test.ts`
Expected: 5 passing.

- [ ] **Step 14: Update `arenaMovement.test.ts` for the extended message**

The extended validator silently drops messages missing `roll`/`aimAngle`, which would fail every movement assertion. In `server/src/__tests__/arenaMovement.test.ts`, replace the `IDLE` constant with:

```ts
const IDLE = { up: false, down: false, left: false, right: false, roll: false, aimAngle: 0 };
```

(Every input literal in that file spreads `IDLE`, so this one line is the whole fix. `arenaRoom.test.ts` sends no inputs.)

- [ ] **Step 14b: Full gates (regression — the whole repo compiles against the new sim)**

Run: `pnpm --filter @genzed/shared build && pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 15: E2E regression (prediction rewiring is render-path code)**

Run: `pnpm test:e2e`
Expected: movement + smoke specs green.

- [ ] **Step 16: Commit**

```bash
git add shared/src server/src client/src tests
git commit -m "feat(sim): sim-state stepPlayer with roll FSM threaded through prediction; parity test"
```

---

### Task 5: Combat schema + client mirror + React sync filter

**Files:**
- Modify: `server/src/schema/ArenaState.ts`
- Modify: `server/src/rooms/ArenaRoom.ts` (tick counter + aimAngle write)
- Modify: `client/src/lobby/arenaState.ts`
- Modify: `client/src/lobby/useArenaRoom.ts`
- Modify: `client/src/App.tsx`

The React sync filter MUST land with the schema (spec risk #2): once bullets patch at 20 Hz, `room.onStateChange(sync)` would re-render the React tree 20×/s. Replace it with targeted listeners — React only cares about `phase`, `countdownMs`, and player membership (verified: `Lobby.tsx` renders only `name`/`joinedAt`/membership; HUD reads schema directly inside Phaser).

- [ ] **Step 1: Rewrite `server/src/schema/ArenaState.ts`** (full new content)

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
  // sim fields (Task 4)
  @type("uint8") rollTicksLeft = 0;
  @type("uint8") rollDirMask = 0;
  @type("uint8") rollCooldownTicks = 0;
  @type("uint8") speedBonus = 0;
  // combat fields
  @type("uint8") hp = 100;
  @type("uint8") gunLevel = 1; // 1..6; 6 = won
  @type("int16") ammo = 10; // -1 encodes ∞ (L5)
  @type("number") reloadStartedAt = 0; // server-clock ms; 0 = not reloading
  @type("float32") aimAngle = 0; // radians; remote gun rendering
  @type("number") immuneUntil = 0; // server-clock ms; respawn immunity
}

export class Bullet extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("uint8") level = 1; // sprite frame selection
  @type("uint32") spawnTick = 0; // L5 lifetime; client TTL fallback
  // shooter sessionId stays in room memory — kill credit is server business
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type("uint32") tick = 0;
  @type("string") winnerName = "";
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
}
```

- [ ] **Step 2: Wire the new fields in `server/src/rooms/ArenaRoom.ts`**

(a) First line inside the `tick()` playing-phase body (right after the phase guard):

```ts
    this.state.tick += 1;
```

(b) In the input-application loop, after `player.lastProcessedInput = input.seq;` add:

```ts
        player.aimAngle = input.aimAngle;
```

(c) In `assignSpawns()`, extend the per-player reset (after the sim-field resets from Task 4):

```ts
      player.hp = PLAYER_HEALTH;
      player.gunLevel = 1;
      player.ammo = gunForLevel(1).clip;
      player.reloadStartedAt = 0;
      player.aimAngle = 0;
      player.immuneUntil = 0;
```

and after the `forEach`, clear the game-scoped collections:

```ts
    this.state.bullets.clear();
    this.state.winnerName = "";
```

(Imports: add `PLAYER_HEALTH`, `gunForLevel` to the `@genzed/shared` import.)

- [ ] **Step 3: Rewrite `client/src/lobby/arenaState.ts`** (full new content)

```ts
import type { Phase } from "@genzed/shared";

// @colyseus/schema 2.x instance callbacks are callable and return a detach fn —
// cast at call sites like the existing players.onAdd usage.
export type SchemaCallbacks = {
  onChange: (cb: () => void) => unknown;
};

export type LobbyPlayer = SchemaCallbacks & {
  name: string;
  ready: boolean;
  joinedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  lastProcessedInput: number;
  rollTicksLeft: number;
  rollDirMask: number;
  rollCooldownTicks: number;
  speedBonus: number;
  hp: number;
  gunLevel: number;
  ammo: number;
  reloadStartedAt: number;
  aimAngle: number;
  immuneUntil: number;
};

export type BulletView = SchemaCallbacks & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  level: number;
  spawnTick: number;
};

export type SchemaMap<T> = {
  size: number;
  forEach(cb: (item: T, key: string) => void): void;
  get(key: string): T | undefined;
  values(): IterableIterator<T>;
  keys(): IterableIterator<string>;
  onAdd: (cb: (item: T, key: string) => void) => unknown;
  onRemove: (cb: (item: T, key: string) => void) => unknown;
};

export type LobbyPlayers = SchemaMap<LobbyPlayer>;

export type ArenaState = {
  phase: Phase;
  countdownMs: number;
  tick: number;
  winnerName: string;
  players: LobbyPlayers;
  bullets: SchemaMap<BulletView>;
  // schema 2.x property listener — callable, returns a detach fn
  listen: (
    prop: "phase" | "countdownMs" | "winnerName" | "tick",
    cb: (value: unknown, previous: unknown) => void,
  ) => unknown;
};
```

- [ ] **Step 4: Targeted listeners in `client/src/lobby/useArenaRoom.ts`**

Replace the line `room.onStateChange(sync);` with:

```ts
    // Targeted listeners instead of onStateChange: bullet/position churn patches
    // 20×/s once combat ships — React must only re-render on lobby-relevant
    // changes (phase, countdown, membership). HUD reads schema inside Phaser.
    room.state.listen("phase", sync);
    room.state.listen("countdownMs", sync);
    room.state.players.onAdd(sync);
    room.state.players.onRemove(sync);
```

- [ ] **Step 5: Keep the canvas mounted through the win banner in `client/src/App.tsx`**

Replace the GameMount condition:

```ts
  if (
    (hook.status === "joined" || hook.status === "reconnecting") &&
    (hook.phase === "playing" || hook.phase === "ended")
  ) {
```

(The banner renders in-Phaser on `"ended"`; when the server resets to lobby 10 s later, `phase` flips and React swaps back to the Lobby view.)

- [ ] **Step 6: Gates**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean — schema widening is backward-compatible with every existing test.

- [ ] **Step 7: E2E regression (the sync rewiring touches lobby → arena flow)**

Run: `pnpm test:e2e`
Expected: smoke + movement green (lobby renders, countdown ticks, arena mounts).

- [ ] **Step 8: Commit**

```bash
git add server/src client/src
git commit -m "feat(schema): combat fields, bullet entities, ended phase; React sync narrowed to lobby-relevant changes"
```

---

### Task 6: Fire / reload / active-reload commands — TDD

**Files:**
- Modify: `server/src/rooms/ArenaRoom.ts`
- Create: `server/src/sim/bullets.ts` (types only; `stepBullets` arrives in Task 7)
- Test: `server/src/__tests__/arenaCombat.test.ts`

Commands are server-gated messages outside the seq'd input channel (they bypass the 2-per-tick cap). All timing gates compare **server** `Date.now()`. Legacy behavior ported: dry fire auto-reloads; one active-reload attempt per reload (success ends it, miss jams it).

- [ ] **Step 1: Create `server/src/sim/bullets.ts`** (types; Task 7 adds the integrator)

```ts
export type BulletMeta = {
  shooterId: string;
  damage: number; // snapshot at fire time (includes active-reload bonus)
  diesAtTick: number; // L5 lifetime; MAX_SAFE_INTEGER = until wall/world
};

export type Target = { id: string; x: number; y: number; immune: boolean };

export type Hit = { victimId: string; shooterId: string; damage: number };
```

- [ ] **Step 2: Write the failing tests** — `server/src/__tests__/arenaCombat.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_INPUT,
  MSG_FIRE,
  MSG_RELOAD,
  MSG_ACTIVE_RELOAD,
  EVT_RELOAD_RESULT,
  RELOAD_MS,
  type ReloadResultEvent,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const IDLE = { up: false, down: false, left: false, right: false, roll: false, aimAngle: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  // Swallow broadcasts the SDK would otherwise warn about.
  c1.onMessage("*", () => {});
  c2.onMessage("*", () => {});
  c1.send(MSG_START_GAME);
  await sleep(3300); // real 3 s countdown
  expect(room.state.phase).toBe("playing");
  const p1 = room.state.players.get(c1.sessionId);
  const p2 = room.state.players.get(c2.sessionId);
  if (!p1 || !p2) throw new Error("players missing");
  return { room, c1, c2, p1, p2 };
}

describe("game-start combat reset", () => {
  it("initializes hp/gun/ammo on entering playing", async () => {
    const { p1 } = await startedGame();
    expect(p1.hp).toBe(100);
    expect(p1.gunLevel).toBe(1);
    expect(p1.ammo).toBe(10);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);
});

describe("fire gates", () => {
  it("spawns a bullet flying toward the target and spends ammo", async () => {
    const { room, c1, p1 } = await startedGame();
    // (128,128) firing right along the verified-clear row to (992,128) — the
    // bullet must still be alive when we look (Task 7 makes bullets move and
    // die on walls; a fire ray with a wall ~60 px out would vaporize it).
    p1.x = 128;
    p1.y = 128;
    c1.send(MSG_FIRE, { tx: 228, ty: 128 });
    await sleep(150);
    expect(room.state.bullets.size).toBe(1);
    const bullet = [...room.state.bullets.values()][0];
    if (!bullet) throw new Error("bullet missing");
    expect(bullet.vx).toBeCloseTo(500, 3); // pistol speed, straight right
    expect(bullet.vy).toBeCloseTo(0, 3);
    expect(bullet.level).toBe(1);
    expect(p1.ammo).toBe(9);
  }, 10_000);

  it("rate-limits to the gun's fire interval", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.x = 128;
    p1.y = 128; // clear fire ray — see above
    c1.send(MSG_FIRE, { tx: 228, ty: 128 });
    c1.send(MSG_FIRE, { tx: 228, ty: 128 }); // inside the 350 ms pistol interval
    await sleep(150);
    expect(room.state.bullets.size).toBe(1);
    expect(p1.ammo).toBe(9);
  }, 10_000);

  it("rejects malformed fire payloads", async () => {
    const { room, c1 } = await startedGame();
    c1.send(MSG_FIRE, { tx: "nope" });
    c1.send(MSG_FIRE, { tx: Infinity, ty: 0 });
    await sleep(150);
    expect(room.state.bullets.size).toBe(0);
    expect(room.state.phase).toBe("playing"); // room alive
  }, 10_000);

  it("blocks fire while reloading", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.ammo = 4;
    c1.send(MSG_RELOAD);
    await sleep(100);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
  }, 10_000);

  it("dry fire auto-reloads instead of shooting (legacy behavior)", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.ammo = 0;
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    await sleep(RELOAD_MS + 300); // tick completes the reload
    expect(p1.reloadStartedAt).toBe(0);
    expect(p1.ammo).toBe(10);
  }, 10_000);

  it("blocks fire mid-roll", async () => {
    const { room, c1 } = await startedGame();
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, roll: true, right: true });
    await sleep(120); // roll is 600 ms; we're inside it
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
  }, 10_000);
});

describe("reload + active reload", () => {
  it("ignores reload with a full clip", async () => {
    const { c1, p1 } = await startedGame();
    c1.send(MSG_RELOAD);
    await sleep(100);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);

  it("active reload inside [1350,1650] ms refills instantly and reports ok", async () => {
    const { c1, p1 } = await startedGame();
    const results: ReloadResultEvent[] = [];
    c1.onMessage(EVT_RELOAD_RESULT, (m: ReloadResultEvent) => results.push(m));
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(1450); // mid-window
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(results).toEqual([{ ok: true }]);
    expect(p1.ammo).toBe(10);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);

  it("active reload outside the window jams: completion pushed past normal", async () => {
    const { c1, p1 } = await startedGame();
    const results: ReloadResultEvent[] = [];
    c1.onMessage(EVT_RELOAD_RESULT, (m: ReloadResultEvent) => results.push(m));
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(300); // way early
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(results).toEqual([{ ok: false }]);
    // At T+2300 a normal reload (2000 ms) would be done — the jam isn't.
    await sleep(1850);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    expect(p1.ammo).toBe(3);
  }, 10_000);

  it("allows only one active-reload attempt per reload", async () => {
    const { c1, p1 } = await startedGame();
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(300);
    c1.send(MSG_ACTIVE_RELOAD); // jam
    await sleep(1150); // now at ~1450 — inside the window, but attempt is spent
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(p1.ammo).toBe(3); // no refill
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
  }, 10_000);
});
```

- [ ] **Step 3: Run to verify failures**

Run: `pnpm -C server exec vitest run src/__tests__/arenaCombat.test.ts`
Expected: FAIL — fire/reload messages unhandled (bullets never spawn, reload never starts). The reset test may pass already (Task 5 wired it); that's fine.

- [ ] **Step 4: Implement commands in `server/src/rooms/ArenaRoom.ts`**

(a) Extend the `@genzed/shared` import with: `MSG_FIRE`, `MSG_RELOAD`, `MSG_ACTIVE_RELOAD`, `EVT_SHOT`, `EVT_RELOAD_RESULT`, `WIN_GUN_LEVEL`, `RELOAD_MS`, `RELOAD_JAM_TOTAL_MS`, `ACTIVE_RELOAD_WINDOW_MS`, `ACTIVE_RELOAD_DAMAGE_BONUS`, `ACTIVE_RELOAD_BONUS_MS`, `type FireMessage`, `type ShotEvent`, `type ReloadResultEvent` (plus `gunForLevel`/`PLAYER_HEALTH` from Task 5). Import `Bullet` from the schema module and `type BulletMeta` from `../sim/bullets.js`.

(b) Module-level, next to `isInputMessage`:

```ts
type CombatMeta = {
  nextFireAt: number;
  reloadCompleteAt: number;
  activeReloadUsed: boolean;
  damageBonusUntil: number;
  bulletCounter: number;
  prevRank: number; // rank-change feed lines (Task 7)
};

function freshCombatMeta(): CombatMeta {
  return {
    nextFireAt: 0,
    reloadCompleteAt: 0,
    activeReloadUsed: false,
    damageBonusUntil: 0,
    bulletCounter: 0,
    prevRank: 0,
  };
}

function isFireMessage(m: unknown): m is FireMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.tx === "number" &&
    Number.isFinite(o.tx) &&
    typeof o.ty === "number" &&
    Number.isFinite(o.ty)
  );
}
```

(c) Class fields:

```ts
  private combat = new Map<string, CombatMeta>();
  private bulletMeta = new Map<string, BulletMeta>();
```

(d) Lifecycle wiring: in `onJoin` add `this.combat.set(client.sessionId, freshCombatMeta());`; in `removePlayer` add `this.combat.delete(sessionId);`. In `onCreate`:

```ts
    this.onMessage(MSG_FIRE, (client, message: unknown) => this.handleFire(client, message));
    this.onMessage(MSG_RELOAD, (client) => this.handleReload(client));
    this.onMessage(MSG_ACTIVE_RELOAD, (client) => this.handleActiveReload(client));
```

In `assignSpawns`, after the player loop, also reset metas: 

```ts
    this.combat.forEach((_meta, sessionId) => this.combat.set(sessionId, freshCombatMeta()));
    this.bulletMeta.clear();
```

(e) The handlers:

```ts
  private handleFire(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isFireMessage(message)) return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.gunLevel >= WIN_GUN_LEVEL) return;
    if (player.rollTicksLeft > 0) return; // fire input ignored mid-roll
    if (player.reloadStartedAt > 0) return;
    const now = Date.now();
    if (now < meta.nextFireAt) return;
    if (player.ammo === 0) {
      this.beginReload(player, meta, now); // legacy: dry fire auto-reloads
      return;
    }
    const gun = gunForLevel(player.gunLevel);
    // Velocity from the AUTHORITATIVE position toward the requested point —
    // bullets converge on the point (legacy gun.js:95), one spawn at player center.
    const dx = message.tx - player.x;
    const dy = message.ty - player.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const bullet = new Bullet();
    bullet.x = player.x;
    bullet.y = player.y;
    bullet.vx = (dx / d) * gun.bulletSpeed;
    bullet.vy = (dy / d) * gun.bulletSpeed;
    bullet.level = player.gunLevel;
    bullet.spawnTick = this.state.tick;
    const id = `${client.sessionId}:${meta.bulletCounter}`;
    meta.bulletCounter += 1;
    this.state.bullets.set(id, bullet);
    this.bulletMeta.set(id, {
      shooterId: client.sessionId,
      damage: gun.damage + (now < meta.damageBonusUntil ? ACTIVE_RELOAD_DAMAGE_BONUS : 0),
      diesAtTick:
        gun.bulletLifetimeMs > 0
          ? this.state.tick + Math.max(1, Math.round(gun.bulletLifetimeMs / TICK_MS))
          : Number.MAX_SAFE_INTEGER,
    });
    if (player.ammo > 0) player.ammo -= 1; // -1 encodes ∞ (L5)
    meta.nextFireAt = now + gun.fireIntervalMs;
    const shot: ShotEvent = { shooterId: client.sessionId, level: player.gunLevel, x: player.x, y: player.y };
    this.broadcast(EVT_SHOT, shot);
  }

  private beginReload(player: Player, meta: CombatMeta, now: number): void {
    if (player.reloadStartedAt > 0) return;
    const gun = gunForLevel(player.gunLevel);
    if (gun.clip === -1 || player.ammo === gun.clip) return;
    player.reloadStartedAt = now;
    meta.reloadCompleteAt = now + RELOAD_MS;
    meta.activeReloadUsed = false;
  }

  private handleReload(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.rollTicksLeft > 0) return; // reload input ignored mid-roll
    this.beginReload(player, meta, Date.now());
  }

  private handleActiveReload(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.rollTicksLeft > 0) return;
    if (player.reloadStartedAt === 0 || meta.activeReloadUsed) return;
    meta.activeReloadUsed = true;
    const now = Date.now();
    const elapsed = now - player.reloadStartedAt;
    const [lo, hi] = ACTIVE_RELOAD_WINDOW_MS;
    let result: ReloadResultEvent;
    if (elapsed >= lo && elapsed <= hi) {
      player.ammo = gunForLevel(player.gunLevel).clip;
      player.reloadStartedAt = 0;
      meta.damageBonusUntil = now + ACTIVE_RELOAD_BONUS_MS;
      result = { ok: true };
    } else {
      meta.reloadCompleteAt = now + RELOAD_JAM_TOTAL_MS; // jam pushes completion out
      result = { ok: false };
    }
    client.send(EVT_RELOAD_RESULT, result);
  }
```

(f) Reload completion in `tick()` — add after the input-drain `forEach`:

```ts
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const meta = this.combat.get(sessionId);
      if (!meta) return;
      if (player.reloadStartedAt > 0 && now >= meta.reloadCompleteAt) {
        player.ammo = gunForLevel(player.gunLevel).clip;
        player.reloadStartedAt = 0;
      }
    });
```

- [ ] **Step 5: Run the combat tests**

Run: `pnpm -C server exec vitest run src/__tests__/arenaCombat.test.ts`
Expected: all passing (~45 s — every test waits out the 3.3 s countdown, plus reload sleeps).

- [ ] **Step 6: Full gates**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src
git commit -m "feat(server): fire/reload/active-reload commands with server-side gates"
```

---

### Task 7: Bullet stepping, hit resolution, kill→upgrade→win FSM — TDD

**Files:**
- Modify: `shared/src/grid.ts` (layer-name filter)
- Modify: `server/src/sim/collision.ts` (`loadBulletGrid`)
- Modify: `server/src/sim/bullets.ts` (add `stepBullets`)
- Modify: `server/src/rooms/ArenaRoom.ts` (tick steps 2+5, kill resolution, win FSM, dev teleport)
- Modify+Test: `server/src/__tests__/grid.test.ts`
- Test: `server/src/__tests__/bullets.test.ts`
- Modify+Test: `server/src/__tests__/arenaCombat.test.ts` (kills/respawn/win describe)

Bullets integrate with substeps of ≤16 px (sniper = 50 px/tick; `move()`'s <32 px precondition rules it out, and point-sampling at ≤16 px cannot skip a 16×20 player AABB or a 32 px tile). Hit = point inside the player AABB. Bullets collide with the **bullet grid** (`wallCollision` only — they fly over water and lit-wall tiles, unlike players; legacy `zombieGameState.js:345-358`).

- [ ] **Step 1: Failing test — bullet grid filter** (append to `server/src/__tests__/grid.test.ts`, inside the existing describe)

```ts
  it("builds the bullet grid from wallCollision only (285 tiles)", () => {
    const bulletGrid = buildSolidityGrid(mapJson, ["wallCollision"]);
    let count = 0;
    for (const v of bulletGrid.solid) count += v;
    expect(count).toBe(285); // vs 411 in the player grid — bullets fly over litWall/water
  });
```

Run: `pnpm -C server exec vitest run src/__tests__/grid.test.ts` — FAIL (arity).

- [ ] **Step 2: Add the filter to `shared/src/grid.ts`** — replace `buildSolidityGrid` with:

```ts
// layerNames: include exactly these tile layers (bullet grid = ["wallCollision"]).
// Omitted: include every layer flagged `collision: "true"` (the player grid).
export function buildSolidityGrid(map: TiledMapJson, layerNames?: readonly string[]): SolidityGrid {
  const solid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !layer.data) continue;
    const include = layerNames
      ? layerNames.includes(layer.name)
      : layer.properties?.collision === "true";
    if (!include) continue;
    for (let i = 0; i < layer.data.length; i += 1) {
      if ((layer.data[i] ?? 0) !== 0) solid[i] = 1; // ?? for noUncheckedIndexedAccess
    }
  }
  return { width: map.width, height: map.height, solid };
}
```

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/grid.test.ts` — all passing.

- [ ] **Step 3: Rewrite `server/src/sim/collision.ts`** (full new content — extracts the JSON read, adds the bullet grid)

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

function readMapJson(): TiledMapJson {
  for (const candidate of CANDIDATES) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as TiledMapJson;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`arena map JSON not found; looked in:\n${CANDIDATES.join("\n")}`);
}

let cached: SolidityGrid | null = null;
let cachedBullet: SolidityGrid | null = null;

// Player grid: union of all collision-flagged layers (wall + water + litWall).
export function loadSolidityGrid(): SolidityGrid {
  if (!cached) cached = buildSolidityGrid(readMapJson());
  return cached;
}

// Bullet grid: wallCollision only — bullets fly over water and lit-wall tiles.
export function loadBulletGrid(): SolidityGrid {
  if (!cachedBullet) cachedBullet = buildSolidityGrid(readMapJson(), ["wallCollision"]);
  return cachedBullet;
}
```

(Existing `collision.test.ts` still passes — same public behavior. Optionally add `expect(loadBulletGrid()).toBe(loadBulletGrid())` there for the cache.)

- [ ] **Step 4: Failing tests — `server/src/__tests__/bullets.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { MapSchema } from "@colyseus/schema";
import { Bullet } from "../schema/ArenaState.js";
import { stepBullets, type BulletMeta, type Target } from "../sim/bullets.js";
import type { SolidityGrid } from "@genzed/shared";

function makeGrid(width: number, height: number, solidCells: Array<[number, number]> = []): SolidityGrid {
  const solid = new Uint8Array(width * height);
  for (const [tx, ty] of solidCells) solid[ty * width + tx] = 1;
  return { width, height, solid };
}

function makeBullet(x: number, y: number, vx: number, vy: number): Bullet {
  const b = new Bullet();
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.level = 1;
  b.spawnTick = 0;
  return b;
}

function arena(vx: number, x = 80): { bullets: MapSchema<Bullet>; meta: Map<string, BulletMeta> } {
  const bullets = new MapSchema<Bullet>();
  const meta = new Map<string, BulletMeta>();
  bullets.set("b1", makeBullet(x, 80, vx, 0));
  meta.set("b1", { shooterId: "s", damage: 10, diesAtTick: Number.MAX_SAFE_INTEGER });
  return { bullets, meta };
}

describe("stepBullets", () => {
  it("advances a bullet linearly in open space", () => {
    const { bullets, meta } = arena(200);
    const hits = stepBullets(makeGrid(35, 35), bullets, meta, [], 1);
    expect(hits).toEqual([]);
    expect(bullets.get("b1")?.x).toBeCloseTo(90, 4); // 200 px/s × 50 ms
  });

  it("kills a sniper-speed bullet at a wall instead of tunneling", () => {
    // Wall tile (5,2) spans x [160,192). Sniper covers 50 px/tick from x=130 —
    // substeps of 12.5 px sample 167.5, inside the wall.
    const { bullets, meta } = arena(1000, 130);
    const hits = stepBullets(makeGrid(35, 35, [[5, 2]]), bullets, meta, [], 1);
    expect(hits).toEqual([]);
    expect(bullets.size).toBe(0); // dead at the wall, not past it
  });

  it("a sniper-speed bullet cannot skip a player AABB", () => {
    const { bullets, meta } = arena(1000, 130);
    const target: Target = { id: "v", x: 160, y: 80, immune: false }; // AABB x [152,168]
    const hits = stepBullets(makeGrid(35, 35), bullets, meta, [target], 1);
    expect(hits).toEqual([{ victimId: "v", shooterId: "s", damage: 10 }]);
    expect(bullets.size).toBe(0);
  });

  it("never hits the shooter or immune targets (flies through)", () => {
    const { bullets, meta } = arena(200);
    const targets: Target[] = [
      { id: "s", x: 85, y: 80, immune: false }, // the shooter, in the path
      { id: "i", x: 88, y: 80, immune: true }, // immune, in the path
    ];
    const hits = stepBullets(makeGrid(35, 35), bullets, meta, targets, 1);
    expect(hits).toEqual([]);
    expect(bullets.size).toBe(1);
  });

  it("expires lifetime-limited (L5) bullets AFTER their final move (~10 px)", () => {
    const { bullets, meta } = arena(200);
    const m = meta.get("b1");
    if (!m) throw new Error("meta missing");
    m.diesAtTick = 1; // spawnTick 0 + 1 tick of life
    const hits = stepBullets(makeGrid(35, 35), bullets, meta, [], 1);
    expect(hits).toEqual([]);
    expect(bullets.size).toBe(0); // moved its 10 px, then expired
  });

  it("dies leaving the world", () => {
    const { bullets, meta } = arena(1000, 1115);
    stepBullets(makeGrid(35, 35), bullets, meta, [], 1);
    expect(bullets.size).toBe(0);
  });
});
```

Run: `pnpm -C server exec vitest run src/__tests__/bullets.test.ts` — FAIL (`stepBullets` not exported).

- [ ] **Step 5: Implement `stepBullets`** — full new content of `server/src/sim/bullets.ts`:

```ts
import type { MapSchema } from "@colyseus/schema";
import {
  TICK_MS,
  TILE_SIZE,
  PLAYER_W,
  PLAYER_H,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BULLET_SUBSTEP_PX,
  isSolidTile,
  type SolidityGrid,
} from "@genzed/shared";
import type { Bullet } from "../schema/ArenaState.js";

export type BulletMeta = {
  shooterId: string;
  damage: number; // snapshot at fire time (includes active-reload bonus)
  diesAtTick: number; // L5 lifetime; MAX_SAFE_INTEGER = until wall/world
};

export type Target = { id: string; x: number; y: number; immune: boolean };

export type Hit = { victimId: string; shooterId: string; damage: number };

const HW = PLAYER_W / 2;
const HH = PLAYER_H / 2;

// Substepped point integration: ≤16 px per sample means neither a 32 px tile
// nor a 16×20 player AABB can be skipped at any gun's speed (sniper = 50
// px/tick). Bullets collide with the BULLET grid (wallCollision only) and with
// player AABBs; the shooter and immune players are transparent.
export function stepBullets(
  grid: SolidityGrid,
  bullets: MapSchema<Bullet>,
  meta: Map<string, BulletMeta>,
  targets: Target[],
  tick: number,
): Hit[] {
  const hits: Hit[] = [];
  const dead: string[] = [];
  const dt = TICK_MS / 1000;
  bullets.forEach((b, id) => {
    const m = meta.get(id);
    if (!m) {
      dead.push(id);
      return;
    }
    const stepX = b.vx * dt;
    const stepY = b.vy * dt;
    const substeps = Math.max(1, Math.ceil(Math.hypot(stepX, stepY) / BULLET_SUBSTEP_PX));
    for (let s = 0; s < substeps; s += 1) {
      b.x += stepX / substeps;
      b.y += stepY / substeps;
      if (b.x < 0 || b.y < 0 || b.x >= WORLD_WIDTH || b.y >= WORLD_HEIGHT) {
        dead.push(id);
        return;
      }
      if (isSolidTile(grid, Math.floor(b.x / TILE_SIZE), Math.floor(b.y / TILE_SIZE))) {
        dead.push(id);
        return;
      }
      for (const t of targets) {
        if (t.id === m.shooterId || t.immune) continue;
        if (Math.abs(b.x - t.x) <= HW && Math.abs(b.y - t.y) <= HH) {
          hits.push({ victimId: t.id, shooterId: m.shooterId, damage: m.damage });
          dead.push(id);
          return;
        }
      }
    }
    if (tick >= m.diesAtTick) dead.push(id); // expire AFTER the final move
  });
  for (const id of dead) {
    bullets.delete(id);
    meta.delete(id);
  }
  return hits;
}
```

Run: `pnpm -C server exec vitest run src/__tests__/bullets.test.ts` — 6 passing.

- [ ] **Step 6: Failing tests — kills/respawn/win** (append to `server/src/__tests__/arenaCombat.test.ts`)

Extend the file's imports with: `MSG_DEV_TELEPORT`, `MSG_END_GAME`, `EVT_LOG`, `EVT_SHOT`, `SPAWN_POINTS`, `GUN_L5_SPEED_BONUS`, `type LogEvent`, `type ShotEvent`. Shooter is **b** (`c2`, joined second, starts ranked 2nd) so a level-up also produces a rank line.

```ts
describe("kills, respawn, win FSM", () => {
  it("a hit drops hp by the gun's damage", async () => {
    const { c2, p1, p2 } = await startedGame();
    p2.x = 384;
    p2.y = 416;
    p1.x = 224;
    p1.y = 704; // verified LoS pair on the bullet grid
    c2.send(MSG_FIRE, { tx: 224, ty: 704 });
    await sleep(1200); // ~329 px at 500 px/s ≈ 660 ms + tick slack
    expect(p1.hp).toBe(90);
  }, 10_000);

  it("a kill respawns the victim, credits the shooter, and announces all three lines", async () => {
    const { room, c1, c2, p1, p2 } = await startedGame();
    const logs: LogEvent[] = [];
    const shots: ShotEvent[] = [];
    c1.onMessage(EVT_LOG, (m: LogEvent) => logs.push(m));
    c1.onMessage(EVT_SHOT, (m: ShotEvent) => shots.push(m));
    p2.x = 384;
    p2.y = 416;
    p1.x = 224;
    p1.y = 704;
    p1.hp = 10; // one pistol hit kills
    c2.send(MSG_FIRE, { tx: 224, ty: 704 });
    await sleep(1200);
    // Victim: teleported to a spawn point, full hp, immune.
    expect(p1.hp).toBe(100);
    const spawnSet = new Set(SPAWN_POINTS.map((s) => `${s.x},${s.y}`));
    expect(spawnSet.has(`${p1.x},${p1.y}`)).toBe(true);
    expect(p1.immuneUntil).toBeGreaterThan(0);
    // Shooter: leveled up, clip reset to the SMG's.
    expect(p2.gunLevel).toBe(2);
    expect(p2.ammo).toBe(30);
    // Feed lines (legacy strings) + the shot broadcast reached the other client.
    expect(shots).toHaveLength(1);
    expect(shots[0]?.shooterId).toBe(c2.sessionId);
    expect(logs.some((l) => l.kind === "slain" && l.text === "b has slain a")).toBe(true);
    expect(logs.some((l) => l.kind === "levelup" && l.text === "b has advanced to Gun Level: 2")).toBe(true);
    expect(logs.some((l) => l.kind === "rank" && l.text === "b has taken 1st place")).toBe(true);
    expect(room.state.bullets.size).toBe(0); // consumed by the hit
  }, 10_000);

  it("immunity blocks damage", async () => {
    const { c2, p1, p2 } = await startedGame();
    p2.x = 384;
    p2.y = 416;
    p1.x = 224;
    p1.y = 704;
    p1.hp = 50;
    p1.immuneUntil = Date.now() + 5000;
    c2.send(MSG_FIRE, { tx: 224, ty: 704 });
    await sleep(1200);
    expect(p1.hp).toBe(50);
  }, 10_000);

  it("L5 grants the speed bonus; level 6 wins, ends the phase, and dev end_game resets", async () => {
    const { room, c1, c2, p1, p2 } = await startedGame();
    const logs: LogEvent[] = [];
    c1.onMessage(EVT_LOG, (m: LogEvent) => logs.push(m));
    p2.gunLevel = 4;
    p2.x = 384;
    p2.y = 416;
    p1.x = 224;
    p1.y = 704;
    p1.hp = 10;
    c2.send(MSG_FIRE, { tx: 224, ty: 704 }); // heavy: 200 px/s → ~1.65 s flight
    await sleep(2200);
    expect(p2.gunLevel).toBe(5);
    expect(p2.speedBonus).toBe(GUN_L5_SPEED_BONUS);
    expect(p2.ammo).toBe(-1); // melee ∞ clip
    // Second kill needs point-blank range (L5 bullets live ~10 px). The victim
    // respawned mid-sleep, so its 1 s immunity may still be running — clear it
    // (direct server-side write, same as the other fixtures).
    p1.x = p2.x + 8;
    p1.y = p2.y;
    p1.hp = 10;
    p1.immuneUntil = 0;
    c2.send(MSG_FIRE, { tx: p1.x, ty: p1.y });
    await sleep(400);
    expect(p2.gunLevel).toBe(6);
    expect(room.state.phase).toBe("ended");
    expect(room.state.winnerName).toBe("b");
    expect(room.state.bullets.size).toBe(0);
    expect(logs.some((l) => l.kind === "win" && l.text === "b has won the game!")).toBe(true);
    // Dev end_game skips the 10 s banner (works from "ended" too).
    c2.send(MSG_END_GAME);
    await sleep(150);
    expect(room.state.phase).toBe("lobby");
    expect(room.state.winnerName).toBe("");
  }, 15_000);

  it("dev teleport moves the sender (E2E seam)", async () => {
    const { c1, p1 } = await startedGame();
    c1.send(MSG_DEV_TELEPORT, { x: 384, y: 416 });
    await sleep(150);
    expect(p1.x).toBe(384);
    expect(p1.y).toBe(416);
  }, 10_000);
});
```

Run: `pnpm -C server exec vitest run src/__tests__/arenaCombat.test.ts` — new describe FAILS (bullets never move, nothing resolves).

- [ ] **Step 7: Wire the tick + resolution into `server/src/rooms/ArenaRoom.ts`**

(a) Imports: add `MSG_DEV_TELEPORT`, `EVT_LOG`, `SPAWN_POINTS` (already there), `RESPAWN_IMMUNITY_MS`, `GUN_L5_SPEED_BONUS`, `WIN_BANNER_MS`, `type DevTeleportMessage`, `type LogEvent`, `type LogKind` from `@genzed/shared`; `loadBulletGrid` from `../sim/collision.js`; `stepBullets`, `type Hit`, `type Target` from `../sim/bullets.js`.

(b) Class field + module constant:

```ts
  private bulletGrid = loadBulletGrid();
```

```ts
const PLACES = ["1st", "2nd", "3rd", "4th"] as const;
```

(c) Message registration in `onCreate`:

```ts
    this.onMessage(MSG_DEV_TELEPORT, (client, message: unknown) => this.handleDevTeleport(client, message));
```

(d) Module-level validator next to the others:

```ts
function isDevTeleportMessage(m: unknown): m is DevTeleportMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    Number.isFinite(o.x) &&
    typeof o.y === "number" &&
    Number.isFinite(o.y)
  );
}
```

(e) Append to `tick()` after the reload-completion pass (reusing its `const now`):

```ts
    // 2. Bullets: substepped integration vs bullet grid + player AABBs.
    const targets: Target[] = [];
    this.state.players.forEach((p, id) => {
      targets.push({ id, x: p.x, y: p.y, immune: p.immuneUntil > now });
    });
    const hits = stepBullets(this.bulletGrid, this.state.bullets, this.bulletMeta, targets, this.state.tick);
    for (const hit of hits) this.resolveHit(hit, now);
```

(f) New private methods:

```ts
  private broadcastLog(kind: LogKind, text: string): void {
    const log: LogEvent = { kind, text };
    this.broadcast(EVT_LOG, log);
  }

  private resolveHit(hit: Hit, now: number): void {
    const victim = this.state.players.get(hit.victimId);
    if (!victim) return;
    if (victim.immuneUntil > now) return; // killed-and-respawned earlier this same tick
    victim.hp = Math.max(0, victim.hp - hit.damage);
    if (victim.hp > 0) return;
    const shooter = this.state.players.get(hit.shooterId);
    this.broadcastLog("slain", `${shooter?.name ?? "?"} has slain ${victim.name}`);
    this.respawn(victim, now);
    if (!shooter || shooter.gunLevel >= WIN_GUN_LEVEL) return;
    shooter.gunLevel += 1;
    if (shooter.gunLevel >= WIN_GUN_LEVEL) {
      this.handleWin(shooter);
      return;
    }
    const gun = gunForLevel(shooter.gunLevel);
    shooter.ammo = gun.clip;
    shooter.reloadStartedAt = 0; // new gun arrives loaded
    shooter.speedBonus = shooter.gunLevel === 5 ? GUN_L5_SPEED_BONUS : 0;
    this.broadcastLog("levelup", `${shooter.name} has advanced to Gun Level: ${shooter.gunLevel}`);
    this.announceRankChanges(true);
  }

  private respawn(player: Player, now: number): void {
    const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    if (!p) return; // noUncheckedIndexedAccess; unreachable (non-empty table)
    player.x = p.x;
    player.y = p.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = PLAYER_HEALTH;
    player.immuneUntil = now + RESPAWN_IMMUNITY_MS;
    player.rollTicksLeft = 0;
    player.rollDirMask = 0;
    player.rollCooldownTicks = 0;
    // lastProcessedInput is NOT reset — the replay-guard watermark must survive.
  }

  // Deviation 8: announce the player whose rank improved, by name.
  private announceRankChanges(announce: boolean): void {
    const order: Array<[string, Player]> = [];
    this.state.players.forEach((p, id) => order.push([id, p]));
    order.sort(([, a], [, b]) => b.gunLevel - a.gunLevel || a.joinedAt - b.joinedAt);
    order.forEach(([sessionId, player], rank) => {
      const meta = this.combat.get(sessionId);
      if (!meta) return;
      if (announce && rank < meta.prevRank) {
        this.broadcastLog("rank", `${player.name} has taken ${PLACES[rank] ?? `${rank + 1}th`} place`);
      }
      meta.prevRank = rank;
    });
  }

  private handleWin(winner: Player): void {
    this.state.winnerName = winner.name;
    this.state.phase = "ended";
    this.broadcastLog("win", `${winner.name} has won the game!`);
    this.state.bullets.clear();
    this.bulletMeta.clear();
    this.clock.setTimeout(() => {
      if (this.state.phase === "ended") this.resetToLobby();
    }, WIN_BANNER_MS);
  }

  private resetToLobby(): void {
    this.state.phase = "lobby";
    this.state.countdownMs = 0;
    this.state.winnerName = "";
    this.state.bullets.clear();
    this.bulletMeta.clear();
    this.inputQueues.forEach((queue) => {
      queue.length = 0;
    });
    this.state.players.forEach((player) => {
      player.ready = false;
    });
  }

  private handleDevTeleport(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isDevTeleportMessage(message)) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.x = message.x;
    player.y = message.y;
    player.vx = 0;
    player.vy = 0;
    player.rollTicksLeft = 0;
  }
```

(g) Replace `handleEndGame` with the reset delegation (the dev message now also skips the win banner):

```ts
  private handleEndGame(_client: Client): void {
    if (this.state.phase !== "playing" && this.state.phase !== "ended") return;
    this.resetToLobby();
  }
```

(h) In `assignSpawns`, after the combat-meta reset line from Task 6, seed ranks silently:

```ts
    this.announceRankChanges(false);
```

- [ ] **Step 8: Run the whole combat suite**

Run: `pnpm -C server exec vitest run src/__tests__/arenaCombat.test.ts`
Expected: all passing (~75 s — countdown waits + bullet flight sleeps).

- [ ] **Step 9: Full gates**

Run: `pnpm --filter @genzed/shared build && pnpm test && pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add shared/src server/src
git commit -m "feat(server): substepped bullets, hit resolution, kill credit, respawn immunity, win FSM"
```

---

### Task 8: Client combat — aim, fire, reload input, guns, crosshair, bullets, roll anims, immunity tint

**Files:**
- Modify: `client/src/game/animations.ts`
- Rewrite: `client/src/game/scenes/ArenaScene.ts`
- (No unit tests — client has no unit harness at prototype tier; covered by the combat E2E in Task 10 and the room tests' message contracts.)

Rendering rules: every player gets a gun sprite orbiting `GUN_ORBIT_PX = 10` px from center (legacy `gun.pivot.x = -10`), rotated to the aim angle, y-flipped when aiming left. Local aim is pointer-immediate; remote aim comes from schema `aimAngle`. Bullets render from schema entities and dead-reckon at frame rate (`x += vx·dt` — linear motion, extrapolation exact), snapped on each patch via `onChange`, destroyed on schema remove. The crosshair replaces the OS cursor over the canvas.

- [ ] **Step 1: Rewrite `client/src/game/animations.ts`** (full new content — adds gun/crosshair atlas keys, roll tables, `rollAnimFor`)

```ts
import type Phaser from "phaser";
import { DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT } from "@genzed/shared";

export const PLAYER_ATLAS = "player";
export const GUN_ATLAS = "guns"; // finalGunSheet — gun AND bullet frames
export const CROSSHAIR_ATLAS = "crosshair";
export const CROSSHAIR_FRAME = "reticle_box_001.png";
export const IDLE_FRAME = "playerSprites_243.png";

export const ANIM = {
  down: "walk-down",
  up: "walk-up",
  right: "walk-right", // walking left = this animation with flipX (legacy behavior)
  idle: "idle",
  rollDown: "roll-down",
  rollUp: "roll-up",
  rollRight: "roll-right", // roll-left = this animation with flipX (legacy scale -1)
} as const;

// DIR_LEFT maps to the right-walk animation — the scene sets flipX for left.
export const DIR_ANIM: Record<number, string> = {
  [DIR_DOWN]: ANIM.down,
  [DIR_UP]: ANIM.up,
  [DIR_LEFT]: ANIM.right,
  [DIR_RIGHT]: ANIM.right,
};

// Legacy player.js animation tables (numeric atlas indices), resolved to the
// frame names at those positions in playerRolls.json. 10 fps. Use verbatim.
const WALK_FRAMES: Record<string, string[]> = {
  [ANIM.right]: [
    "playerSprites_57 copy.png",
    "lookingRightRightLegUp.png",
    "RightComingDown1.png",
    "playerSprites_266 copy.png",
    "movingRight4.png",
    "movingRight5.png",
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

// Legacy roll tables (player.js:112-114 indices → playerRolls.json hash order).
// Played once per roll (no loop); the roll FSM flips back to walk/idle after.
const ROLL_FRAMES: Record<string, string[]> = {
  [ANIM.rollUp]: [
    "playerSprites_299.png",
    "playerSprites_289.png",
    "playerSprites_312.png",
    "playerSprites_286.png",
    "playerSprites_252.png",
    "playerSprites_253.png",
    "playerSprites_251.png",
  ],
  [ANIM.rollDown]: [
    "playerSprites_300.png",
    "playerSprites_292.png",
    "playerSprites_311.png",
    "playerSprites_256.png",
    "playerSprites_257.png",
    "playerSprites_255.png",
  ],
  [ANIM.rollRight]: [
    "playerSprites_244.png",
    "playerSprites_245.png",
    "playerSprites_243.png",
    "New Piskel (2).png",
    "New Piskel (3).png",
    "playerSprites_260.png",
  ],
};

// Roll animation by roll-direction mask — horizontal wins (same rule as walking).
export function rollAnimFor(mask: number): { key: string; flipX: boolean } {
  if ((mask & 8) !== 0) return { key: ANIM.rollRight, flipX: false };
  if ((mask & 4) !== 0) return { key: ANIM.rollRight, flipX: true };
  if ((mask & 1) !== 0) return { key: ANIM.rollUp, flipX: false };
  return { key: ANIM.rollDown, flipX: false };
}

export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const [key, frames] of Object.entries(WALK_FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: -1,
    });
  }
  for (const [key, frames] of Object.entries(ROLL_FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: 0,
    });
  }
}
```

- [ ] **Step 2: Rewrite `client/src/game/scenes/ArenaScene.ts`** (full new content — incorporates Tasks 4/5 and adds the combat layer; HUD/sounds land in Task 9)

```ts
import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  MSG_INPUT,
  MSG_FIRE,
  MSG_RELOAD,
  MSG_ACTIVE_RELOAD,
  MSG_DEV_TELEPORT,
  TICK_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  RECONCILE_SNAP_PX,
  RESPAWN_IMMUNITY_MS,
  DIR_LEFT,
  buildSolidityGrid,
  gunForLevel,
  LocalPrediction,
  type PlayerSim,
  type SimInput,
  type SolidityGrid,
  type TiledMapJson,
} from "@genzed/shared";
import type { ArenaState, BulletView, LobbyPlayer } from "../../lobby/arenaState.js";
import {
  ANIM,
  CROSSHAIR_ATLAS,
  CROSSHAIR_FRAME,
  DIR_ANIM,
  GUN_ATLAS,
  IDLE_FRAME,
  PLAYER_ATLAS,
  registerPlayerAnimations,
  rollAnimFor,
} from "../animations.js";
import { RemoteInterpolation } from "../net/interpolation.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

type PlayerView = {
  player: LobbyPlayer; // live schema ref
  sprite: Phaser.GameObjects.Sprite;
  gun: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  interp: RemoteInterpolation | null; // null for the local player
  prevHp: number;
  unsubscribe: () => void;
};

type BulletSpriteView = {
  bullet: BulletView; // live schema ref
  sprite: Phaser.GameObjects.Sprite;
  unsubscribe: () => void;
};

type ArenaDebugHook = {
  players: () => Array<{ id: string; x: number; y: number; hp: number; gunLevel: number; local: boolean }>;
  fire: (tx: number, ty: number) => void;
  teleport: (x: number, y: number) => void;
  // Consented leave so E2E teardown doesn't trip the 10s reconnection grace.
  leave: () => void;
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

const GUN_ORBIT_PX = 10; // legacy gun.pivot.x = -10
const IMMUNITY_TINT = 0x66ccff;

function simFromPlayer(p: LobbyPlayer): PlayerSim {
  return {
    x: p.x,
    y: p.y,
    dir: p.dir,
    rollTicksLeft: p.rollTicksLeft,
    rollDirMask: p.rollDirMask,
    rollCooldownTicks: p.rollCooldownTicks,
    speedBonus: p.speedBonus,
  };
}

export class ArenaScene extends Phaser.Scene {
  private room!: Room<ArenaState>;
  private localSessionId = "";
  private views = new Map<string, PlayerView>();
  private bulletViews = new Map<string, BulletSpriteView>();
  private grid!: SolidityGrid;
  private prediction: LocalPrediction | null = null;
  private keys!: Record<"W" | "A" | "S" | "D" | "SPACE" | "R", Phaser.Input.Keyboard.Key>;
  private crosshair!: Phaser.GameObjects.Image;
  private localAimAngle = 0;
  private nextFireAt = 0; // client-side mirror of the fire gate (server re-gates)
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super("arena");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/main.json");
    this.load.image("dungeon", "assets/images/mapTiles/dungeon_tileset_32.png");
    this.load.image("dungeonObjs", "assets/images/mapTiles/objects_tilset_32.png");
    this.load.atlas(PLAYER_ATLAS, "assets/images/playerRolls.png", "assets/images/playerRolls.json");
    this.load.atlas(GUN_ATLAS, "assets/images/finalGunSheet.png", "assets/images/finalGunSheet.json");
    this.load.atlas(CROSSHAIR_ATLAS, "assets/images/crosshair.png", "assets/images/crosshair.json");
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
      this.room.state.bullets.onAdd((b, id) => {
        if (!this.bulletViews.has(id)) this.addBullet(id, b);
      }) as unknown as () => void,
      this.room.state.bullets.onRemove((_b, id) => this.removeBullet(id)) as unknown as () => void,
    );

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,R") as ArenaScene["keys"];
    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.sampleInput() });

    // Crosshair replaces the OS cursor over the arena.
    this.input.setDefaultCursor("none");
    this.crosshair = this.add.image(0, 0, CROSSHAIR_ATLAS, CROSSHAIR_FRAME).setDepth(1000);

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Phaser 3 does NOT auto-call a method named shutdown() (that was Phaser 2);
    // wire it explicitly or the schema listeners outlive the scene. Listen for
    // BOTH events: game.destroy(true) — GameMount's teardown path — emits only
    // DESTROY, never SHUTDOWN. shutdown() is idempotent.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.shutdown());

    // E2E hook (read by tests/movement.spec.ts and tests/combat.spec.ts).
    (window as unknown as { __arena?: ArenaDebugHook }).__arena = {
      players: () =>
        [...this.views.entries()].map(([id, view]) => ({
          id,
          x: view.sprite.x,
          y: view.sprite.y,
          hp: view.player.hp,
          gunLevel: view.player.gunLevel,
          local: id === this.localSessionId,
        })),
      fire: (tx: number, ty: number) => void this.room.send(MSG_FIRE, { tx, ty }),
      teleport: (x: number, y: number) => void this.room.send(MSG_DEV_TELEPORT, { x, y }),
      leave: () => void this.room.leave(true),
    };
  }

  private addPlayer(sessionId: string, player: LobbyPlayer): void {
    const isLocal = sessionId === this.localSessionId;
    const sprite = this.add.sprite(player.x, player.y, PLAYER_ATLAS, IDLE_FRAME).setDepth(5);
    sprite.play(ANIM.idle);
    const gun = this.add
      .sprite(player.x, player.y, GUN_ATLAS, gunForLevel(player.gunLevel).gunFrame)
      .setDepth(6);
    const label = this.add
      .text(player.x, player.y - 14, isLocal ? `${player.name} (you)` : player.name, LABEL_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(7);

    if (isLocal) {
      // Seed the seq counter past the server's watermark so a mid-game
      // reconnect doesn't send seqs the replay guard has already acked.
      this.prediction = new LocalPrediction(simFromPlayer(player), this.grid, player.lastProcessedInput + 1);
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      const unsubscribe = player.onChange(() => {
        this.prediction?.reconcile(simFromPlayer(player), player.lastProcessedInput);
      }) as unknown as () => void;
      this.views.set(sessionId, { player, sprite, gun, label, interp: null, prevHp: player.hp, unsubscribe });
    } else {
      const interp = new RemoteInterpolation();
      interp.push(player.x, player.y, player.dir);
      const unsubscribe = player.onChange(() => {
        interp.push(player.x, player.y, player.dir);
      }) as unknown as () => void;
      this.views.set(sessionId, { player, sprite, gun, label, interp, prevHp: player.hp, unsubscribe });
    }
  }

  private removePlayer(sessionId: string): void {
    const view = this.views.get(sessionId);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    view.gun.destroy();
    view.label.destroy();
    this.views.delete(sessionId);
  }

  private addBullet(id: string, bullet: BulletView): void {
    const sprite = this.add
      .sprite(bullet.x, bullet.y, GUN_ATLAS, gunForLevel(bullet.level).bulletFrame)
      .setRotation(Math.atan2(bullet.vy, bullet.vx))
      .setDepth(4);
    const unsubscribe = bullet.onChange(() => {
      sprite.setPosition(bullet.x, bullet.y); // server patch corrects dead reckoning
    }) as unknown as () => void;
    this.bulletViews.set(id, { bullet, sprite, unsubscribe });
  }

  private removeBullet(id: string): void {
    const view = this.bulletViews.get(id);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    this.bulletViews.delete(id);
  }

  private sampleInput(): void {
    if (!this.prediction) return;
    const input: SimInput = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
      roll: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
    };
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    this.localAimAngle = Math.atan2(pointer.worldY - this.prediction.y, pointer.worldX - this.prediction.x);
    const msg = this.prediction.sample(input, this.localAimAngle);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);

    const me = this.room.state.players.get(this.localSessionId);
    if (!me) return;

    // R: reload — or the active-reload attempt while a reload is running.
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.room.send(me.reloadStartedAt > 0 ? MSG_ACTIVE_RELOAD : MSG_RELOAD);
    }

    // Full-auto while held, self-gated at the gun's interval (server re-gates).
    if (pointer.isDown && performance.now() >= this.nextFireAt) {
      this.room.send(MSG_FIRE, { tx: pointer.worldX, ty: pointer.worldY });
      this.nextFireAt = performance.now() + gunForLevel(me.gunLevel).fireIntervalMs;
    }
  }

  private playRollAnimation(sprite: Phaser.GameObjects.Sprite, mask: number): void {
    const roll = rollAnimFor(mask);
    sprite.play(roll.key, true);
    sprite.setFlipX(roll.flipX);
  }

  private updateLocalAnimation(input: SimInput): void {
    const view = this.views.get(this.localSessionId);
    if (!view || !this.prediction) return;
    if (this.prediction.sim.rollTicksLeft > 0) {
      this.playRollAnimation(view.sprite, this.prediction.sim.rollDirMask);
      return;
    }
    const moving = input.up || input.down || input.left || input.right;
    if (!moving) {
      view.sprite.play(ANIM.idle, true);
      view.sprite.setFlipX(false);
      return;
    }
    // Horizontal wins on diagonals — same rule as the server's `dir`.
    // Walking left = the right animation mirrored (legacy behavior).
    const goingLeft = input.left && !input.right;
    const key = input.right || goingLeft ? ANIM.right : input.down ? ANIM.down : ANIM.up;
    view.sprite.play(key, true);
    view.sprite.setFlipX(goingLeft);
  }

  override update(_time: number, delta: number): void {
    // Local player: render toward the predicted position. Prediction advances in
    // tick-sized steps at 20 Hz; the per-frame lerp smooths that into continuous motion.
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

    // Remote players: sample INTERP_BUFFER_MS in the past; roll anim overrides walk.
    this.views.forEach((view, id) => {
      if (id === this.localSessionId) return;
      const s = view.interp?.sample();
      if (!s) return;
      view.sprite.setPosition(s.x, s.y);
      if (view.player.rollTicksLeft > 0) {
        this.playRollAnimation(view.sprite, view.player.rollDirMask);
      } else {
        view.sprite.play(s.moving ? (DIR_ANIM[s.dir] ?? ANIM.idle) : ANIM.idle, true);
        view.sprite.setFlipX(s.moving && s.dir === DIR_LEFT);
      }
    });

    // Guns orbit their player, rotated to aim; labels ride above; immunity tints.
    this.views.forEach((view, id) => {
      const angle = id === this.localSessionId ? this.localAimAngle : view.player.aimAngle;
      view.gun.setFrame(gunForLevel(view.player.gunLevel).gunFrame);
      view.gun.setPosition(
        view.sprite.x + Math.cos(angle) * GUN_ORBIT_PX,
        view.sprite.y + Math.sin(angle) * GUN_ORBIT_PX,
      );
      view.gun.setRotation(angle);
      view.gun.setFlipY(Math.abs(angle) > Math.PI / 2);
      view.label.setPosition(view.sprite.x, view.sprite.y - 14);
      if (view.player.hp === 100 && view.prevHp < 100) {
        // Respawn observed (hp snapped back to full) — tint for the immunity window.
        view.sprite.setTint(IMMUNITY_TINT);
        this.time.delayedCall(RESPAWN_IMMUNITY_MS, () => view.sprite.clearTint());
      }
      view.prevHp = view.player.hp;
    });

    // Bullets: dead-reckon between patches (linear motion — extrapolation exact).
    const dtSec = delta / 1000;
    this.bulletViews.forEach((view) => {
      view.sprite.x += view.bullet.vx * dtSec;
      view.sprite.y += view.bullet.vy * dtSec;
    });

    // Crosshair follows the pointer in world space.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    this.crosshair.setPosition(pointer.worldX, pointer.worldY);
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
    this.bulletViews.forEach((view) => view.unsubscribe());
    this.bulletViews.clear();
    this.prediction = null;
    // Drop the E2E debug hook — otherwise it dangles holding the destroyed scene graph.
    delete (window as unknown as { __arena?: unknown }).__arena;
  }
}
```

- [ ] **Step 3: Gates**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 4: E2E regression**

Run: `pnpm test:e2e`
Expected: movement + smoke still green (the hook kept its `players()`/`leave()` shape).

- [ ] **Step 5: Manual smoke (dev)**

Run `pnpm dev`, open two browsers at `http://localhost:5173`, join + start. Verify: crosshair replaces the cursor; gun follows the mouse around the player and flips when aiming left; clicking fires a visible bullet that the OTHER browser also sees; SPACE rolls with the roll animation; remote player's gun tracks their aim. (No HUD yet — that's Task 9.)

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): aim/fire/reload/roll input, gun + bullet rendering, crosshair, immunity tint"
```

---

### Task 9: HUD (hearts / ammo / medal / reload bar / kill feed / win banner) + sounds

**Files:**
- Create: `client/src/game/hud.ts`
- Modify: `client/src/game/scenes/ArenaScene.ts` (additive edits below)

Legacy layouts: 10 hearts top-left at `x = 16 + 32·i` (frames 0/1/2 = empty/half/full, clean `hp/10` mapping — NOT legacy's quirky modulo), gunContainer top-right with a 3× gun icon + `ammo / clip` text (∞ for −1), medal top-center (frame = rank by gun level, ties by joinedAt), 30-frame reload bar center-screen (drives active reload: green on success, red freeze on jam), feed lines right side with 3 s TTL, win banner on `phase = "ended"`. Everything `setScrollFactor(0)`.

- [ ] **Step 1: Create `client/src/game/hud.ts`**

```ts
import type Phaser from "phaser";
import { RELOAD_MS, gunForLevel } from "@genzed/shared";
import type { LobbyPlayer } from "../lobby/arenaState.js";
import { GUN_ATLAS } from "./animations.js";

export const HEARTS_KEY = "hearts";
export const GUN_CONTAINER_KEY = "gunContainer";
export const MEDALS_ATLAS = "medals";
export const RELOAD_ATLAS = "reloadBar";

const DEPTH = 900; // above the world, below the crosshair (1000)
const FEED_TTL_MS = 3000;
const FEED_MAX = 6;
const FEED_STYLE = { color: "#f6e05e", fontFamily: "monospace", fontSize: "11px" } as const;
const BANNER_STYLE = {
  color: "#f6e05e",
  fontFamily: "monospace",
  fontSize: "28px",
  align: "center",
} as const;

const reloadFrame = (i: number): string => `New Piskel (14)_${String(i + 1).padStart(2, "0")}.png`;
const medalFrame = (rank: number): string => `medals_0${Math.min(rank, 3) + 1}.png`;

export class ArenaHud {
  private hearts: Phaser.GameObjects.Sprite[] = [];
  private gunIcon: Phaser.GameObjects.Sprite;
  private ammoText: Phaser.GameObjects.Text;
  private medal: Phaser.GameObjects.Sprite;
  private reloadBar: Phaser.GameObjects.Sprite;
  private feedTexts: Phaser.GameObjects.Text[] = [];
  private banner: Phaser.GameObjects.Text;
  readonly feedLines: string[] = []; // rolling log, read by the E2E hook

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < 10; i += 1) {
      this.hearts.push(
        scene.add.sprite(16 + 32 * i, 16, HEARTS_KEY, 2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH),
      );
    }
    scene.add.image(792, 8, GUN_CONTAINER_KEY).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH);
    this.gunIcon = scene.add
      .sprite(792 - 231 / 2, 60, GUN_ATLAS, "pistol.png")
      .setScale(3)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1);
    this.ammoText = scene.add
      .text(792 - 231 / 2, 108, "10 / 10", { color: "#e2e8f0", fontFamily: "monospace", fontSize: "14px" })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1);
    this.medal = scene.add
      .sprite(400, 16, MEDALS_ATLAS, medalFrame(0))
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.reloadBar = scene.add
      .sprite(400, 320, RELOAD_ATLAS, reloadFrame(0))
      .setScale(2)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setVisible(false);
    this.banner = scene.add
      .text(400, 260, "", BANNER_STYLE)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
  }

  updateLocal(me: LobbyPlayer, rank: number): void {
    const full = Math.floor(me.hp / 10);
    this.hearts.forEach((heart, i) => {
      heart.setFrame(i < full ? 2 : i === full && me.hp % 10 >= 5 ? 1 : 0);
    });
    const gun = gunForLevel(me.gunLevel);
    this.gunIcon.setFrame(gun.gunFrame);
    const fmt = (n: number): string => (n === -1 ? "∞" : String(n));
    this.ammoText.setText(`${fmt(me.ammo)} / ${fmt(gun.clip)}`);
    this.medal.setFrame(medalFrame(rank));
  }

  // elapsedMs = time since the locally-observed reload start; null = not reloading.
  updateReload(elapsedMs: number | null, jammed: boolean): void {
    if (elapsedMs === null) {
      this.reloadBar.setVisible(false);
      this.reloadBar.clearTint();
      return;
    }
    this.reloadBar.setVisible(true);
    if (jammed) {
      this.reloadBar.setTint(0xff0000); // frame frozen where the jam happened
      return;
    }
    const frame = Math.min(29, Math.max(0, Math.floor((elapsedMs / RELOAD_MS) * 30)));
    this.reloadBar.setFrame(reloadFrame(frame));
  }

  flashReloadSuccess(): void {
    this.reloadBar.setTint(0x00ff7f); // legacy green; bar hides on the next update
  }

  pushFeedLine(text: string): void {
    this.feedLines.push(text);
    const t = this.scene.add
      .text(792, 0, text, FEED_STYLE)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.feedTexts.unshift(t);
    while (this.feedTexts.length > FEED_MAX) this.feedTexts.pop()?.destroy();
    this.layoutFeed();
    this.scene.time.delayedCall(FEED_TTL_MS, () => {
      const idx = this.feedTexts.indexOf(t);
      if (idx >= 0) this.feedTexts.splice(idx, 1);
      t.destroy();
      this.layoutFeed();
    });
  }

  private layoutFeed(): void {
    this.feedTexts.forEach((t, i) => t.setPosition(792, 150 + 14 * i));
  }

  showBanner(winnerName: string): void {
    this.banner.setText(`${winnerName} has won the game!\nreturning to lobby...`).setVisible(true);
  }
}
```

- [ ] **Step 2: Wire the HUD + sounds into `client/src/game/scenes/ArenaScene.ts`**

(a) Imports — extend the `@genzed/shared` import with `EVT_SHOT`, `EVT_LOG`, `EVT_RELOAD_RESULT`, `type ShotEvent`, `type LogEvent`, `type ReloadResultEvent`; add:

```ts
import { ArenaHud, GUN_CONTAINER_KEY, HEARTS_KEY, MEDALS_ATLAS, RELOAD_ATLAS } from "../hud.js";
```

(b) `preload()` — append:

```ts
    this.load.spritesheet(HEARTS_KEY, "assets/images/ui/hearts.png", { frameWidth: 32, frameHeight: 32 });
    this.load.image(GUN_CONTAINER_KEY, "assets/images/ui/gunContainer.png");
    this.load.atlas(MEDALS_ATLAS, "assets/images/medals.png", "assets/images/medals.json");
    this.load.atlas(RELOAD_ATLAS, "assets/images/reloadBar.png", "assets/images/reloadBar.json");
    this.load.audio("shot", "assets/sounds/heavyPistol.wav");
    this.load.audio("reloadStart", "assets/sounds/pistolReload.mp3");
    this.load.audio("reloadOk", "assets/sounds/reloadSuccess.wav");
    this.load.audio("reloadFail", "assets/sounds/reloadFail.wav");
    this.load.audio("hurt", "assets/sounds/playerHurt.wav");
    this.load.audio("levelup", "assets/sounds/levelUp.wav");
    this.load.audio("win", "assets/sounds/gameWin.wav");
    this.load.audio("theme", "assets/sounds/themeLoop.wav");
```

(c) Class fields — add:

```ts
  private hud!: ArenaHud;
  private reloadUiStart: number | null = null; // performance.now() at observed reload start
  private reloadJammed = false;
  private prevReloadStartedAt = 0;
  private prevOwnHp = 100;
  private prevGunLevel = 0;
  private bannerShown = false;
```

(d) `create()` — after the crosshair setup, add:

```ts
    this.hud = new ArenaHud(this);

    // Broadcast events → sounds / FX / feed. The unbind closures MUST be kept:
    // the Room outlives the scene (win → lobby → next game remounts a fresh
    // scene on the SAME room), and colyseus.js onMessage handlers accumulate —
    // an unbound handler would fire into a destroyed scene next game.
    this.unsubscribers.push(
      this.room.onMessage(EVT_SHOT, (m: ShotEvent) => this.onShot(m)) as unknown as () => void,
      this.room.onMessage(EVT_LOG, (m: LogEvent) => this.hud.pushFeedLine(m.text)) as unknown as () => void,
      this.room.onMessage(EVT_RELOAD_RESULT, (m: ReloadResultEvent) => {
        if (m.ok) {
          this.reloadJammed = false;
          this.hud.flashReloadSuccess();
          this.sound.play("reloadOk");
        } else {
          this.reloadJammed = true;
          this.sound.play("reloadFail");
        }
      }) as unknown as () => void,
    );

    this.sound.play("theme", { loop: true, volume: 0.25 });
```

(The win banner is deliberately NOT a `state.listen("phase")` callback: within one patch, `phase` can decode before `winnerName`, so the listener could read an empty name. The update loop below checks the phase after the whole patch has applied.)

and extend the `__arena` hook object with the feed reader (add the property and the type):

```ts
      feed: () => this.hud.feedLines.slice(),
```

```ts
type ArenaDebugHook = {
  players: () => Array<{ id: string; x: number; y: number; hp: number; gunLevel: number; local: boolean }>;
  fire: (tx: number, ty: number) => void;
  teleport: (x: number, y: number) => void;
  feed: () => string[];
  leave: () => void;
};
```

(e) New private method:

```ts
  private onShot(shot: ShotEvent): void {
    // Muzzle flash for everyone.
    const flash = this.add.circle(shot.x, shot.y, 4, 0xffffaa).setDepth(8);
    this.time.delayedCall(80, () => flash.destroy());
    if (shot.shooterId === this.localSessionId) {
      this.sound.play("shot", { volume: 1 });
      this.cameras.main.shake(40, 0.005); // legacy camera.shake(0.005, 40), Phaser 3 arg order
      return;
    }
    // Legacy linear falloff: 1 - ((distance - 30) / 600), silent beyond earshot.
    const me = this.views.get(this.localSessionId);
    if (!me) return;
    const distance = Math.hypot(shot.x - me.sprite.x, shot.y - me.sprite.y);
    const volume = 1 - (distance - 30) / 600;
    if (volume > 0) this.sound.play("shot", { volume: Math.min(1, volume) });
  }

  // Rank among players by gun level (ties by join order) — drives the medal.
  private localRank(): number {
    const order: Array<{ id: string; gunLevel: number; joinedAt: number }> = [];
    this.room.state.players.forEach((p, id) => order.push({ id, gunLevel: p.gunLevel, joinedAt: p.joinedAt }));
    order.sort((a, b) => b.gunLevel - a.gunLevel || a.joinedAt - b.joinedAt);
    return Math.max(0, order.findIndex((e) => e.id === this.localSessionId));
  }
```

(f) `update()` — append at the end:

```ts
    // HUD + local-player sound triggers (all schema-transition driven; the
    // reload bar runs off the locally-observed start, never the server clock).
    const me = this.room.state.players.get(this.localSessionId);
    if (me) {
      this.hud.updateLocal(me, this.localRank());
      if (me.reloadStartedAt > 0 && this.prevReloadStartedAt === 0) {
        this.reloadUiStart = performance.now();
        this.reloadJammed = false;
        this.sound.play("reloadStart");
      } else if (me.reloadStartedAt === 0 && this.prevReloadStartedAt > 0) {
        this.reloadUiStart = null;
        this.reloadJammed = false;
      }
      this.prevReloadStartedAt = me.reloadStartedAt;
      this.hud.updateReload(
        this.reloadUiStart === null ? null : performance.now() - this.reloadUiStart,
        this.reloadJammed,
      );
      if (me.hp < this.prevOwnHp) this.sound.play("hurt");
      this.prevOwnHp = me.hp;
      if (this.prevGunLevel > 0 && me.gunLevel > this.prevGunLevel) this.sound.play("levelup");
      this.prevGunLevel = me.gunLevel;
    }

    // Win banner: checked here (not in a listen("phase") callback) so the whole
    // patch — including winnerName — has applied before we read it.
    if (this.room.state.phase === "ended" && !this.bannerShown) {
      this.bannerShown = true;
      this.hud.showBanner(this.room.state.winnerName);
      this.sound.play("win");
    }
```

(g) `shutdown()` — add as the first line:

```ts
    this.sound.stopAll();
```

- [ ] **Step 3: Gates**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 4: Manual smoke (dev)**

`pnpm dev`, two browsers: hearts drop in half-steps as you take fire; ammo counts down and the box shows the right gun at 3×; R mid-reload inside the bar's green-ish zone refills instantly (green flash + sound), mistimed R freezes the bar red; kill feed lines appear and fade; medal changes when the other player overtakes; killing 5 times shows the win banner on BOTH screens and the lobby returns ~10 s later; shots audible (closer = louder), camera kicks on own shots. Audio may stay muted until the first click — browser autoplay policy, acceptable.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): combat HUD (hearts/ammo/medal/reload/feed/banner) and legacy sound set"
```

---

### Task 10: Combat E2E

**Files:**
- Create: `tests/combat.spec.ts`

One fat spec (the lobby room is shared; `workers: 1`). Deterministic positioning via the dev-teleport seam onto the verified LoS pair; firing goes through the scene's own `fire()` hook (same send path as the pointer handler). A stray bullet can hit the victim within ~1 s of respawn if it respawns onto the fire line (1-in-8) — the hp assertion tolerates exactly one stray hit rather than flaking.

- [ ] **Step 1: Create `tests/combat.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

// All evaluates inline the window access — closures don't serialize into the page.

// The canvas appears at Phaser boot, BEFORE create() installs window.__arena
// (preload now fetches ~MBs of audio) — wait for the hook or teleports no-op.
async function hookReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __arena?: unknown }).__arena)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function teleportTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]) => {
      (window as unknown as { __arena?: { teleport(a: number, b: number): void } }).__arena?.teleport(px, py);
    },
    [x, y] as const,
  );
}

async function fireAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([tx, ty]) => {
      (window as unknown as { __arena?: { fire(a: number, b: number): void } }).__arena?.fire(tx, ty);
    },
    [x, y] as const,
  );
}

async function ownHp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): Array<{ local: boolean; hp: number }> } }).__arena;
    return hook?.players().find((p) => p.local)?.hp ?? -1;
  });
}

async function ownGunLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): Array<{ local: boolean; gunLevel: number }> } })
      .__arena;
    return hook?.players().find((p) => p.local)?.gunLevel ?? -1;
  });
}

async function feedHas(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((n) => {
    const hook = (window as unknown as { __arena?: { feed(): string[] } }).__arena;
    return hook?.feed().some((line) => line.includes(n)) ?? false;
  }, needle);
}

test("A shoots B: hp drops, slain feed line on both clients, killer levels up, victim respawns", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);
  try {
    await hookReady(pageA);
    await hookReady(pageB);

    // Deterministic LoS pair, verified against the wallCollision grid.
    await teleportTo(pageA, 384, 416);
    await teleportTo(pageB, 224, 704);
    await pageA.waitForTimeout(500); // teleport patches settle

    // Fire until damage registers (pistol: 10 dmg, ~0.7 s flight).
    await expect
      .poll(
        async () => {
          await fireAt(pageA, 224, 704);
          return ownHp(pageB);
        },
        { timeout: 20_000, intervals: [400] },
      )
      .toBeLessThan(100);

    // Keep firing through the kill until the feed announces it.
    await expect
      .poll(
        async () => {
          await fireAt(pageA, 224, 704);
          return feedHas(pageA, "has slain");
        },
        { timeout: 30_000, intervals: [400] },
      )
      .toBe(true);

    // Victim respawned at (or near) full health — ≥90 tolerates one stray
    // in-flight bullet if the respawn rolled the same spawn point.
    await expect.poll(() => ownHp(pageB), { timeout: 5_000 }).toBeGreaterThanOrEqual(90);
    // Killer advanced to gun level 2; the broadcast reached the victim too.
    expect(await ownGunLevel(pageA)).toBe(2);
    expect(await feedHas(pageB, "has slain")).toBe(true);

    // Audio autoplay notices are environmental, not bugs.
    const realErrors = errors.filter((e) => !/AudioContext|autoplay/i.test(e));
    expect(realErrors).toEqual([]);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e`
Expected: smoke + movement + combat all green.

- [ ] **Step 3: Full gates one more time**

Run: `pnpm --filter @genzed/shared build && pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: everything green. If `smoke.spec.ts`/`movement.spec.ts` newly collect audio console errors from the theme autoplay (they assert `errors` strictly), centralize the `/AudioContext|autoplay/i` filter into `tests/helpers.ts` rather than weakening each spec.

- [ ] **Step 4: Commit**

```bash
git add tests/combat.spec.ts
git commit -m "test(e2e): two-client combat — hit, kill feed, level-up, respawn"
```

---

### Task 11: End-to-end verification, evidence, docs

**Files:**
- Create: `docs/stage4-evidence/` screenshots
- Modify: `docs/PROGRESS.md`

Per the repo workflow: verify dev, prod bundle, AND the Docker container before claiming done (Stage 3 convention).

- [ ] **Step 1: Dev verification**

`pnpm dev` → two browsers at `http://localhost:5173` → full fight to a win: aim, shoot, kill ×5, ladder 1→6, banner, auto-return to lobby. Screenshot a mid-fight frame (HUD + bullets + feed visible) → `docs/stage4-evidence/4a-dev-fight.png`.

- [ ] **Step 2: Prod bundle verification**

```bash
pnpm build && PORT=8080 node server/dist/index.js
```

Two browsers at `http://localhost:8080`, repeat a short fight (hit + kill + feed). Screenshot → `docs/stage4-evidence/4a-prod-fight.png`. Stop the server.

- [ ] **Step 3: Docker verification**

```bash
docker build -t genzed:local . && docker run --rm -p 8080:8080 genzed:local
```

Same smoke at `http://localhost:8080`. Screenshot → `docs/stage4-evidence/4a-docker-fight.png`. Stop the container.

- [ ] **Step 4: Update `docs/PROGRESS.md`**

Add a Stage 4A section following the Stage 3 format: shipped date, what landed (sim refactor + parity test, gun ladder, bullets, kills/respawn/win FSM, HUD, sounds, E2E), and operational notes:
- `MSG_DEV_TELEPORT` test seam exists (same trust class as the dev `end_game`).
- `EVT_RELOAD_RESULT` targeted event added beyond the spec's broadcast list (rationale in the plan).
- Bullet grid = `wallCollision` only (285 tiles) vs player grid (411).
- 4B (zombies/pickups/chat/vision cone) is the next plan.

- [ ] **Step 5: Commit + push the branch**

```bash
git add docs/stage4-evidence docs/PROGRESS.md
git commit -m "docs: stage 4A verification evidence and tracker update"
git push -u origin stage-4a-combat
```

- [ ] **Step 6: Finish the branch**

Use `superpowers:finishing-a-development-branch` to merge `stage-4a-combat` → `master` (the Stage 3 pattern: merge locally after gates re-verify green, keep the stage branch on origin).

---

## Plan addenda vs the spec (documented deviations)

1. **`EVT_RELOAD_RESULT`** (targeted client send) — the spec lists only `EVT_SHOT`/`EVT_LOG`. Success can't be derived from schema without racing normal reload completion over the wire; jam/success need instant audio/tint feedback. One extra message type, server → reloading client only.
2. **`MSG_DEV_TELEPORT`** — test seam for the combat E2E (random spawns don't guarantee bullet line-of-sight; only 3 of 28 spawn pairs have it). Same trust class as the existing dev `end_game` message; prototype tier.
3. **`rollDirMask` instead of the spec's `rollDir: DIR_*`** — the roll FSM stores the input mask held at roll start. A single DIR_* can't encode diagonal rolls, which the spec's own tuning requires ("diagonal normalized ×0.7071"). The mask round-trips through the same uint8 schema field.
4. **`ArenaState.tick`** (uint32) — the spec's `Bullet.spawnTick` needs a tick counter visible to both sides; the spec implied but never declared it.
5. **Hit test = bullet point vs player AABB** with ≤16 px substeps — guarantees axis-aligned crossings can't tunnel (16 px target span ≥ 12.5 px max sample spacing); corner-clip misses are accepted at prototype tier.

## Execution notes

- Tasks are strictly ordered: 1→2→3→4→5→6→7→8→9→10→11. Task 4 is the risk kernel — do not start Task 6+ until the parity test is green.
- After ANY `shared/src` edit: `pnpm --filter @genzed/shared build` before running anything that imports it.
- The combat vitest file is slow (~75 s) — that's real countdown/reload/flight time, not a hang.
- If `pnpm why @colyseus/schema` ever shows two versions after Task 1, STOP and fix before proceeding — wire-protocol drift is the worst class of bug here (CLAUDE.md).
