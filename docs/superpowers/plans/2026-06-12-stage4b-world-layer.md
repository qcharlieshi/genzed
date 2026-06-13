# Stage 4B — World Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full game on top of 4A's PvP arena: server-spawned zombies that chase and attack players and die to one bullet, health/speed pickups with respawn cycling, TAB chat, and the client-only vision cone.

**Architecture:** Zombies and pickups are server-stepped schema entities on the existing 20 Hz tick, reusing the shared `move()` sweep (zombies) and player-AABB overlap (pickups, bullet hits). The speed pickup threads through the existing `Player.speedBonus` sim field, so prediction needs zero new code. Chat is a server-gated relay broadcast with a React overlay. The vision cone is pure client rendering: one Phaser GeometryMask used normally on remote entities and inverted on a darkness rect.

**Tech Stack:** Colyseus 0.15 (server 0.15.57 / colyseus.js 0.15.28 / schema 2.0.37), Phaser 3.80, Vitest + @colyseus/testing, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-11-stage4-combat-design.md` — read it first. This plan covers slice **4B only** (4A is merged: `cd662729`).

**Branch:** `stage-4b-world` off `master`.

---

## Plan addenda vs the spec (decided while planning — surface, don't silently diverge)

1. **Spawn/slot validation is test-pinned, not boot-time.** The spec said "validated at boot (nudge or reject)". Validation ran during planning instead: 3 of the 8 legacy zombie points overlap walls under our centered 16×20 AABB and are nudged in the constants — `(250,250)→(266,250)`, `(700,700)→(700,716)`, `(800,800)→(784,800)` (each ≤16 px, verified clear). All 11 legacy pickup slots keep their exact coords: two (`(320,78)`, `(816,78)`) graze the top wall with a full 32×32 box but their **centers** are open floor and the player AABB can overlap them from below, so they're collectable — pickups validate by center tile, zombies by full AABB. A vitest pins all of this against the real map so a map edit can't silently break it. No runtime nudging code.
2. **`EVT_ZOMBIE_ATTACK { x, y }` broadcast (new event).** The spec wants `zombieHit.wav` "wired properly"; the client can't see server-side attacks any other way. Played with the same 30→600 px linear falloff as shots (legacy played it at full volume on one arbitrary client — not worth porting).
3. **Two zombie dev seams** (both registered under the same `NODE_ENV !== "production"` guard as `MSG_DEV_TELEPORT`): `MSG_DEV_ZOMBIE_SPAWNING { enabled }` and `MSG_DEV_SPAWN_ZOMBIE { x, y }`. The toggle exists because natural spawns would chip-damage players mid-assertion in the existing combat E2E (its "respawned ≥90 hp" poll); disabling also removes live zombies, so it's deterministic. The explicit spawn exists because greedy steering has no pathfinding — adversarial review simulated all 8 spawn points against the real map: most zombies wedge on walls or chase the far player, so an E2E that *waits for a zombie to arrive* at a fixed point fails ~30% of runs structurally. The world spec proves the natural spawner works (count > 0), then disables it and dev-spawns zombies at pre-verified coordinates for the chase/attack/kill assertions.
4. **Zombie kills produce no feed line** (and no credit). Verified in legacy: `enemy.js:30-40` calls `receiveDamage(damage)` with no `playerWhoDealtDamage`, so the slain-line branch (`player.js:366-371`) never ran for zombie deaths. Victim respawns with normal immunity, silently.
5. **Zombies stop while in attack range** (no orbiting): legacy pathfinding returned an empty path at range and attacked instead of moving (`enemy.js:65-77`). Between cooldown windows the zombie stands still.
6. **Chat gates to `playing`/`ended` phases** and closes on send (legacy hid the chat container after submit). Messages render only while the overlay is open (legacy's container was hidden otherwise — same behavior).
7. **Vision-cone sight grid = `wallCollision` + `litWallCollision`** (a third grid). Player grid would make water block sight; bullet grid would let lit walls leak light. Lit walls block vision, water doesn't.

## Critical context for implementers

- **`@genzed/shared` exports compiled `dist`, not source.** After ANY edit under `shared/src/`, run `pnpm --filter @genzed/shared build` or server/tests/client resolve stale code. Baked into every task — do not skip.
- **`noUncheckedIndexedAccess` is ON** repo-wide. Indexed reads type as `T | undefined`. All code below is written index-safe — keep it that way.
- **uint8 wraps.** `Player.hp` is `uint8` — always assign `Math.max(0, hp - damage)`, never subtract raw (the existing `resolveHit` does this; zombie attacks must too).
- **Tick math:** 20 Hz, `TICK_MS = 50`. Zombie speed 91 px/s → 4.55 px/tick, safely under `move()`'s <32 px precondition — zombies reuse the player sweep as-is. Zombie spawn cadence 4000 ms = every 80 ticks.
- **Colyseus schema callbacks are callable** in 2.0.37 and return a detach fn — cast `as unknown as () => void` like the existing `ArenaScene` code. `room.onMessage` handlers accumulate on the Room across scene remounts — every handler registered in React/Phaser MUST keep and call its detach closure (see the warning comment in `ArenaScene.create`).
- **Verified zombie atlas facts (use verbatim, do not re-derive).** `zombieSheet.json` hash order: 0 `zombieDeath10.png`, 1 `zombieDeath2.png`, 2 `zombieDeath3.png`, 3 `zombieDeath4.png`, 4 `zombieDeath5.png`, 5 `zombieDeath6.png`, 6 `zombieDeath7 (1).png`, 7 `zombieDeath8.png`, 8 `zombieDeath9.png`, 9 `zombieWalk1.png`, 10 `zombieWalk2.png`, 11 `zombieWalk3.png`, 12 `zombieWalk4.png`, 13 `zombieWalk5 (1).png`, 14 `zombieWalk7 (1).png`. Legacy anims (`enemy.js:9-10`): walk = indices `[9,10,11,12,9,13,14]` @ 9 fps loop; dead = `[1,2,3,4,5,6,7,8,0]` @ 9 fps once. Resolved to names in Task 8. The JSON's `meta.image` says `zombie.png` — harmless, we pass explicit URLs (`zombieSprite.png`). Zombie art faces LEFT natively → `flipX = vx > 0`. Walk frames are 20×24 sourceSize — the shared 16×20 player AABB is the sim hitbox (spec).
- **Legacy feed strings (port verbatim):** `` `${name} has picked up a health pack!` ``, `` `${name} has picked up a speed boost!` `` (`managePickups.js:79-80`), `` `A new health pack has been placed!` ``, `` `A new speed boost has been placed!` `` (`managePickups.js:162-166`). Chat placeholder: `Talk some smack here...` (`chatApp.jsx:71`).
- **Clocks:** all new timing (zombie attack cooldown, speed-boost expiry, pickup respawn, chat rate) is server `Date.now()` compared only server-side, same as 4A. The client never compares its clock to server values.
- **Room tests** use the `startedGame()` pattern from `arenaCombat.test.ts` (real 3.3 s countdown sleep, `c.onMessage("*", () => {})` to swallow broadcasts, direct `room.state` writes as fixtures). Run a single file: `pnpm -C server exec vitest run src/__tests__/<file>.test.ts`. The suite is slow by design; the new world tests add real sleeps too (~+20 s).
- **E2E:** `workers: 1`, specs share the one lobby room — every spec must `close()` in `finally` (helpers do this). The `__arena` window hook is the seam; it installs at scene `create()`, after the canvas appears — use the `hookReady` poll pattern from `combat.spec.ts`.
- A foreign LILT Vite server may hold 127.0.0.1:5173 — run E2E as `CI=1 pnpm test:e2e`; for manual dev runs read genzed Vite's actual port from stdout.

## Tuning quick-reference (legacy-derived unless flagged)

| Constant | Value | Source |
| --- | --- | --- |
| `ZOMBIE_SPEED` | 91 px/s | 350 ms/32 px tween, `enemy.js:72` |
| `ZOMBIE_ATTACK_DAMAGE` | 5 | `enemy.js:12-16` |
| `ZOMBIE_ATTACK_COOLDOWN_MS` | 1000 | `enemy.js:21-22` throttle |
| `ZOMBIE_ATTACK_RANGE_PX` | 28 | spec (canonicalized "same tile") |
| `ZOMBIE_CORPSE_MS` | 4000 | `zombieGameState.js:551` |
| `ZOMBIE_SPAWN_INTERVAL_MS` | 4000 | **INVENTED** — playtest-tune |
| `ZOMBIE_MAX_ALIVE` | 8 | **INVENTED** — playtest-tune |
| `ZOMBIE_SPAWN_POINTS` | 8 points | `enemyGenerator.js:7-18` dedup'd, 3 nudged (addendum 1) |
| `HEALTH_PICKUP_HP` / threshold | +30; ≥70→100 | `managePickups.js:84-87` |
| `SPEED_PICKUP_BONUS` | 100 px/s | `managePickups.js:89` |
| `SPEED_PICKUP_MS` | 5000 (refresh, not stack) | `managePickups.js:90`, spec deviation 4 |
| `PICKUP_RESPAWN_MS` | 8000 | `gameConstants.js:3` |
| `PICKUP_SLOTS` | 11 points | `managePickups.js:26-36` verbatim |
| initial pickups | health @ slots 4, 1; speed @ slots 6, 8 | `managePickups.js:65-73` |
| `CHAT_MAX_LEN` | 200 | spec |
| `CHAT_INTERVAL_MS` | 1000 | spec |
| cone | 90°, 270 px, 0.7 darkness | `Lighting.js:12-14,29` |

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `client/public/assets/images/zombieSprite.png` + `zombieSheet.json` | Create (copy) | Zombie atlas |
| `client/public/assets/images/heart.png`, `speed.png` | Create (copy) | Pickup sprites |
| `client/public/assets/sounds/zombie.wav`, `zombieHit.wav` | Create (copy) | Zombie sounds |
| `shared/src/tuning.ts` | Modify | 4B constants + point tables |
| `shared/src/messages.ts` | Modify | Chat, zombie-attack event, dev spawning toggle |
| `server/src/schema/ArenaState.ts` | Modify | `Zombie`, `Pickup` maps |
| `server/src/sim/zombies.ts` | Create | Zombie targeting/steering/attack step |
| `server/src/sim/bullets.ts` | Modify | Targets gain `kind`; hits report `victimKind` |
| `server/src/sim/pickups.ts` | Create | Pickup effects + slot selection helpers |
| `server/src/rooms/ArenaRoom.ts` | Modify | Zombie/pickup tick steps, spawners, chat, dev toggle, lifecycle resets |
| `server/src/__tests__/world.test.ts` | Create | Tuning pins + placement validity vs the real map |
| `server/src/__tests__/zombies.test.ts` | Create | Zombie sim unit tests |
| `server/src/__tests__/bullets.test.ts` | Modify | Zombie-hit cases; `kind` on targets |
| `server/src/__tests__/pickups.test.ts` | Create | Effect/slot helpers unit tests |
| `server/src/__tests__/arenaWorld.test.ts` | Create | Room integration: spawner, attacks, pickups, chat, resets |
| `client/src/lobby/arenaState.ts` | Modify | `ZombieView`, `PickupView` mirrors |
| `client/src/game/animations.ts` | Modify | Zombie walk/dead animations |
| `client/src/game/scenes/ArenaScene.ts` | Modify | Zombie/pickup views, corpse, sounds, chat input gating, cone, E2E hooks |
| `client/src/game/cone.ts` | Create | Vision cone raycast + masks (Task 12) |
| `client/src/game/ChatOverlay.tsx` | Create | TAB chat React overlay |
| `client/src/game/GameMount.tsx` | Modify | Mount ChatOverlay over the canvas |
| `tests/combat.spec.ts` | Modify | Disable zombie spawning via dev seam |
| `tests/world.spec.ts` | Create | Zombie + pickup + chat E2E |
| `docs/PROGRESS.md` | Modify | 4B shipped entry |

Tasks 1–7 are server-side and land green without any client change (new schema fields are additive; the client mirror is types-only). Tasks 8–11 are the client + E2E. Task 12 (cone) is last and cuttable. Task 13 is docs + final verification.

---

### Task 1: Branch + 4B assets

**Files (copies verbatim from `legacy/client/assets/`):**
- Create: `client/public/assets/images/zombieSprite.png`, `client/public/assets/images/zombieSheet.json`
- Create: `client/public/assets/images/heart.png`, `client/public/assets/images/speed.png`
- Create: `client/public/assets/sounds/zombie.wav`, `client/public/assets/sounds/zombieHit.wav`

Do **not** copy `zombieBackup/` (dead experiment). `heart.png` and `speed.png` are both 32×32 single images (speed renders at 0.5 scale, legacy `pickups.js:26`).

- [ ] **Step 1: Branch**

```bash
cd /Users/qcharlieshi/dev/genzed
git checkout master && git pull && git checkout -b stage-4b-world
```

- [ ] **Step 2: Copy assets**

```bash
cp legacy/client/assets/images/zombieSprite.png legacy/client/assets/images/zombieSheet.json client/public/assets/images/
cp legacy/client/assets/images/heart.png legacy/client/assets/images/speed.png client/public/assets/images/
cp legacy/client/assets/sounds/zombie.wav legacy/client/assets/sounds/zombieHit.wav client/public/assets/sounds/
```

- [ ] **Step 3: Verify**

Run: `ls client/public/assets/images/zombieSprite.png client/public/assets/images/zombieSheet.json client/public/assets/images/heart.png client/public/assets/images/speed.png client/public/assets/sounds/zombie.wav client/public/assets/sounds/zombieHit.wav`
Expected: all six paths print.

- [ ] **Step 4: Commit**

```bash
git add client/public/assets docs/superpowers/plans/2026-06-12-stage4b-world-layer.md
git commit -m "feat(client): copy legacy zombie/pickup assets; stage 4B plan"
```

---

### Task 2: Shared tuning + message contracts — TDD on constants and placement

**Files:**
- Modify: `shared/src/tuning.ts`
- Modify: `shared/src/messages.ts`
- Test: `server/src/__tests__/world.test.ts`

The placement test is the boot-validation replacement (addendum 1): every zombie spawn must be AABB-clear on the **player grid** (zombies move with the player sweep), every pickup slot center must be open floor.

- [ ] **Step 1: Write the failing test** — `server/src/__tests__/world.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  ZOMBIE_SPEED,
  ZOMBIE_ATTACK_DAMAGE,
  ZOMBIE_ATTACK_COOLDOWN_MS,
  ZOMBIE_ATTACK_RANGE_PX,
  ZOMBIE_CORPSE_MS,
  ZOMBIE_SPAWN_INTERVAL_MS,
  ZOMBIE_MAX_ALIVE,
  ZOMBIE_SPAWN_POINTS,
  HEALTH_PICKUP_HP,
  HEALTH_PICKUP_CAP_THRESHOLD,
  SPEED_PICKUP_BONUS,
  SPEED_PICKUP_MS,
  PICKUP_RESPAWN_MS,
  PICKUP_SLOTS,
  PICKUP_INITIAL,
  CHAT_MAX_LEN,
  CHAT_INTERVAL_MS,
  PLAYER_W,
  PLAYER_H,
  TILE_SIZE,
  isSolidTile,
} from "@genzed/shared";
import { loadSolidityGrid } from "../sim/collision.js";

describe("4B tuning pins (legacy-derived; spawner numbers invented per spec)", () => {
  it("zombie stats match the spec table", () => {
    expect(ZOMBIE_SPEED).toBe(91);
    expect(ZOMBIE_ATTACK_DAMAGE).toBe(5);
    expect(ZOMBIE_ATTACK_COOLDOWN_MS).toBe(1000);
    expect(ZOMBIE_ATTACK_RANGE_PX).toBe(28);
    expect(ZOMBIE_CORPSE_MS).toBe(4000);
    expect(ZOMBIE_SPAWN_INTERVAL_MS).toBe(4000);
    expect(ZOMBIE_MAX_ALIVE).toBe(8);
  });

  it("pickup rules match legacy", () => {
    expect(HEALTH_PICKUP_HP).toBe(30);
    expect(HEALTH_PICKUP_CAP_THRESHOLD).toBe(70);
    expect(SPEED_PICKUP_BONUS).toBe(100);
    expect(SPEED_PICKUP_MS).toBe(5000);
    expect(PICKUP_RESPAWN_MS).toBe(8000);
    expect(CHAT_MAX_LEN).toBe(200);
    expect(CHAT_INTERVAL_MS).toBe(1000);
  });

  it("pickup slots are the 11 legacy points; initial layout is health@4,1 speed@6,8", () => {
    expect(PICKUP_SLOTS).toHaveLength(11);
    expect(PICKUP_SLOTS[4]).toEqual({ x: 544, y: 514 });
    expect(PICKUP_SLOTS[1]).toEqual({ x: 575, y: 275 });
    expect(PICKUP_SLOTS[6]).toEqual({ x: 544, y: 573 });
    expect(PICKUP_SLOTS[8]).toEqual({ x: 1056, y: 670 });
    expect(PICKUP_INITIAL).toEqual([
      { kind: 0, slot: 4 },
      { kind: 0, slot: 1 },
      { kind: 1, slot: 6 },
      { kind: 1, slot: 8 },
    ]);
  });
});

describe("placement validity vs the real map (boot-validation replacement)", () => {
  const grid = loadSolidityGrid();
  const HW = PLAYER_W / 2;
  const HH = PLAYER_H / 2;
  const EPS = 1e-3;

  function aabbClear(x: number, y: number): boolean {
    const tx0 = Math.floor((x - HW) / TILE_SIZE);
    const tx1 = Math.floor((x + HW - EPS) / TILE_SIZE);
    const ty0 = Math.floor((y - HH) / TILE_SIZE);
    const ty1 = Math.floor((y + HH - EPS) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (isSolidTile(grid, tx, ty)) return false;
      }
    }
    return true;
  }

  it("all 8 zombie spawn points are AABB-clear on the player grid", () => {
    expect(ZOMBIE_SPAWN_POINTS).toHaveLength(8);
    for (const p of ZOMBIE_SPAWN_POINTS) {
      expect(aabbClear(p.x, p.y), `zombie spawn (${p.x},${p.y})`).toBe(true);
    }
  });

  it("all 11 pickup slot centers are open floor", () => {
    for (const s of PICKUP_SLOTS) {
      const solid = isSolidTile(grid, Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE));
      expect(solid, `pickup slot (${s.x},${s.y})`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/world.test.ts`
Expected: FAIL — the 4B constants are not exported from `@genzed/shared`.

- [ ] **Step 3: Append to `shared/src/tuning.ts`**

```ts
// === Stage 4B: world layer (same spec) ===

export const ZOMBIE_SPEED = 91; // px/s — legacy 350 ms per 32 px tile tween
export const ZOMBIE_ATTACK_DAMAGE = 5;
export const ZOMBIE_ATTACK_COOLDOWN_MS = 1000;
export const ZOMBIE_ATTACK_RANGE_PX = 28; // center distance ("same tile" canonicalized)
export const ZOMBIE_CORPSE_MS = 4000; // client-side death anim lifetime
// INVENTED (legacy shipped no spawner) — starting guesses, tune in playtest.
export const ZOMBIE_SPAWN_INTERVAL_MS = 4000;
export const ZOMBIE_MAX_ALIVE = 8;

// Legacy enemyGenerator.js spawn list, deduplicated (10 → 8 unique). Three
// points overlap walls under our centered 16×20 AABB and are nudged ≤16 px
// into verified-open floor: (250,250)→(266,250), (700,700)→(700,716),
// (800,800)→(784,800). Pinned against the real map by world.test.ts.
export const ZOMBIE_SPAWN_POINTS = [
  { x: 200, y: 200 },
  { x: 400, y: 400 },
  { x: 600, y: 600 },
  { x: 266, y: 250 },
  { x: 500, y: 500 },
  { x: 700, y: 716 },
  { x: 784, y: 800 },
  { x: 900, y: 900 },
] as const;

export const PICKUP_KIND_HEALTH = 0;
export const PICKUP_KIND_SPEED = 1;

export const HEALTH_PICKUP_HP = 30; // below the threshold: +30
export const HEALTH_PICKUP_CAP_THRESHOLD = 70; // at/above: set to 100
export const SPEED_PICKUP_BONUS = 100; // px/s, refreshes (never stacks — deviation 4)
export const SPEED_PICKUP_MS = 5000;
export const PICKUP_RESPAWN_MS = 8000;

// Legacy managePickups.js slot table, verbatim. Slots 0 and 2 visually graze
// the top wall (32×32 sprite) but their centers are open floor and the player
// AABB overlaps them from below — collectable, pinned by world.test.ts.
export const PICKUP_SLOTS = [
  { x: 320, y: 78 },
  { x: 575, y: 275 },
  { x: 816, y: 78 },
  { x: 64, y: 640 },
  { x: 544, y: 514 },
  { x: 607, y: 514 },
  { x: 544, y: 573 },
  { x: 607, y: 573 },
  { x: 1056, y: 670 },
  { x: 481, y: 1056 },
  { x: 670, y: 1056 },
] as const;

// Game-start layout: 2 health, 2 speed (legacy initHealth/initSpeed).
export const PICKUP_INITIAL: readonly { kind: number; slot: number }[] = [
  { kind: PICKUP_KIND_HEALTH, slot: 4 },
  { kind: PICKUP_KIND_HEALTH, slot: 1 },
  { kind: PICKUP_KIND_SPEED, slot: 6 },
  { kind: PICKUP_KIND_SPEED, slot: 8 },
];

export const CHAT_MAX_LEN = 200;
export const CHAT_INTERVAL_MS = 1000; // per-player send rate

// Vision cone (client-only render constants; Lighting.js:12-14,29)
export const CONE_ANGLE_RAD = Math.PI / 2;
export const CONE_LENGTH_PX = 270;
export const CONE_RAYS = 60;
export const CONE_DARKNESS_ALPHA = 0.7;
```

- [ ] **Step 4: Append to `shared/src/messages.ts`**

```ts
// --- Stage 4B world layer ---

export const MSG_CHAT = "chat";
export type ChatMessage = { text: string };

export const EVT_CHAT = "chat_line";
export type ChatEvent = { name: string; text: string };

// Plan addendum 2: positional zombieHit.wav — clients can't see server-side
// attacks any other way.
export const EVT_ZOMBIE_ATTACK = "zombie_attack";
export type ZombieAttackEvent = { x: number; y: number };

// Dev/test seams (NODE_ENV !== production), same trust class as MSG_DEV_TELEPORT.
// Disabling spawning also removes live zombies; the explicit spawn exists
// because greedy steering makes natural-spawn E2E targeting structurally
// flaky (plan addendum 3).
export const MSG_DEV_ZOMBIE_SPAWNING = "dev_zombie_spawning";
export type DevZombieSpawningMessage = { enabled: boolean };

export const MSG_DEV_SPAWN_ZOMBIE = "dev_spawn_zombie";
export type DevSpawnZombieMessage = { x: number; y: number };
```

- [ ] **Step 5: Build shared, run the test**

Run: `pnpm --filter @genzed/shared build && pnpm -C server exec vitest run src/__tests__/world.test.ts`
Expected: 5 passing (3 pin tests + 2 placement tests).

- [ ] **Step 6: Full gates (regression)**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean — additions only, nothing consumes them yet.

- [ ] **Step 7: Commit**

```bash
git add shared/src server/src/__tests__/world.test.ts
git commit -m "feat(shared): 4B tuning (zombies, pickups, chat, cone) + message contracts"
```

---

### Task 3: Schema — Zombie + Pickup maps + client mirror types

**Files:**
- Modify: `server/src/schema/ArenaState.ts`
- Modify: `client/src/lobby/arenaState.ts`

Additive schema only — wire-compatible with the running client until the room writes to it. The React sync in `useArenaRoom.ts` needs **no change**: it already uses targeted listeners (phase/countdown/membership), so zombie/pickup churn never re-renders React. Verify, don't edit.

- [ ] **Step 1: Add to `server/src/schema/ArenaState.ts`** (below the `Bullet` class)

```ts
export class Zombie extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0; // sign drives client flipX (art faces left); 0 = standing
  // attack cooldown stays in room memory (zombieMeta) — server business
}

export class Pickup extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("uint8") kind = 0; // PICKUP_KIND_HEALTH | PICKUP_KIND_SPEED
}
```

and to `ArenaState`:

```ts
  @type({ map: Zombie }) zombies = new MapSchema<Zombie>();
  @type({ map: Pickup }) pickups = new MapSchema<Pickup>();
```

- [ ] **Step 2: Mirror in `client/src/lobby/arenaState.ts`** (below `BulletView`)

```ts
export type ZombieView = SchemaCallbacks & {
  x: number;
  y: number;
  vx: number;
};

export type PickupView = SchemaCallbacks & {
  x: number;
  y: number;
  kind: number;
};
```

and add to the `ArenaState` type (after `bullets`):

```ts
  zombies: SchemaMap<ZombieView>;
  pickups: SchemaMap<PickupView>;
```

- [ ] **Step 3: Gates**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. (No behavior yet; existing tests untouched.)

- [ ] **Step 4: Commit**

```bash
git add server/src/schema client/src/lobby/arenaState.ts
git commit -m "feat(schema): Zombie and Pickup map schemas + client mirrors"
```

---

### Task 4: Bullet targets gain `kind` + zombie sim — TDD

**Files:**
- Modify: `server/src/sim/bullets.ts`
- Modify: `server/src/__tests__/bullets.test.ts`
- Modify: `server/src/rooms/ArenaRoom.ts` (one line — keeps typecheck green)
- Create: `server/src/sim/zombies.ts`
- Test: `server/src/__tests__/zombies.test.ts`

Two halves. First, `stepBullets` targets grow a `kind` so bullets can hit zombies with the same 16×20 AABB and the room can tell what died. Second, the zombie step function (mutates zombie x/y/vx in place, same style as `stepBullets`). Targeting is **nearest** player (spec deviation 1 — legacy's comparison selected the farthest). In range → stand still and attack on cooldown (addendum 5); attacks skip immune players (legacy `receiveDamage` returned early on `immune`).

- [ ] **Step 1: Extend `server/src/sim/bullets.ts`**

Replace the `Target` and `Hit` types:

```ts
export type Target = { id: string; x: number; y: number; immune: boolean; kind: "player" | "zombie" };

export type Hit = { victimId: string; shooterId: string; damage: number; victimKind: "player" | "zombie" };
```

and in the AABB loop, replace the `hits.push(...)` line with:

```ts
          hits.push({ victimId: t.id, shooterId: m.shooterId, damage: m.damage, victimKind: t.kind });
```

(The shooter-skip `t.id === m.shooterId` and the `t.immune` skip stay; zombies are passed with `immune: false`, and zombie ids never collide with session ids.)

- [ ] **Step 2: Update `server/src/__tests__/bullets.test.ts`**

Four `Target` literals gain `kind: "player"` (the `"a sniper-speed bullet cannot skip a player AABB"` target, the two in `"never hits the shooter or immune targets"`, and the one in the L5-expiry test). The two `Hit` expectations gain `victimKind: "player"`:

```ts
    expect(hits).toEqual([{ victimId: "v", shooterId: "s", damage: 10, victimKind: "player" }]);
```

(both occurrences). Then add a zombie case to the describe, using the file's existing `makeGrid`/`arena` helpers:

```ts
  it("hits zombies with the same AABB and reports victimKind", () => {
    const { bullets, meta } = arena(500); // from x=80, rightward
    const zombie: Target = { id: "z1", x: 100, y: 80, immune: false, kind: "zombie" };
    const hits = stepBullets(makeGrid(35, 35), bullets, meta, [zombie], 1);
    expect(hits).toEqual([{ victimId: "z1", shooterId: "s", damage: 10, victimKind: "zombie" }]);
    expect(bullets.size).toBe(0); // bullet consumed by the hit
  });
```

Run: `pnpm -C server exec vitest run src/__tests__/bullets.test.ts`
Expected: all passing.

- [ ] **Step 3: One-line `ArenaRoom.ts` fix so the package still typechecks**

In `tick()`, the player-targets push gains the kind:

```ts
      targets.push({ id, x: p.x, y: p.y, immune: p.immuneUntil > now, kind: "player" });
```

Run: `pnpm -C server exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Write the failing zombie-sim test** — `server/src/__tests__/zombies.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MapSchema } from "@colyseus/schema";
import {
  ZOMBIE_SPEED,
  ZOMBIE_ATTACK_DAMAGE,
  ZOMBIE_ATTACK_COOLDOWN_MS,
  ZOMBIE_ATTACK_RANGE_PX,
  TICK_MS,
  buildSolidityGrid,
  type TiledMapJson,
} from "@genzed/shared";
import { Zombie } from "../schema/ArenaState.js";
import { stepZombies, type ZombieMeta } from "../sim/zombies.js";
import type { Target } from "../sim/bullets.js";

// Open 20×20 test grid, optionally with solid tiles (same helper shape as move.test.ts).
function makeGrid(w: number, h: number, solids: Array<[number, number]> = []) {
  const layer = {
    name: "wallCollision",
    type: "tilelayer",
    data: new Array(w * h).fill(0) as number[],
    properties: { collision: "true" },
  };
  for (const [tx, ty] of solids) layer.data[ty * w + tx] = 1;
  const map: TiledMapJson = { width: w, height: h, tilewidth: 32, tileheight: 32, layers: [layer] };
  return buildSolidityGrid(map);
}

function world(zs: Array<{ id: string; x: number; y: number }>) {
  const zombies = new MapSchema<Zombie>();
  const meta = new Map<string, ZombieMeta>();
  for (const z of zs) {
    const zombie = new Zombie();
    zombie.x = z.x;
    zombie.y = z.y;
    zombies.set(z.id, zombie);
    meta.set(z.id, { nextAttackAt: 0 });
  }
  return { zombies, meta };
}

function player(id: string, x: number, y: number, immune = false): Target {
  return { id, x, y, immune, kind: "player" };
}

const DT = TICK_MS / 1000;

describe("stepZombies", () => {
  it("moves straight toward the nearest player at ZOMBIE_SPEED (deviation 1)", () => {
    const g = makeGrid(20, 20);
    const { zombies, meta } = world([{ id: "z1", x: 160, y: 160 }]);
    // far player at (480,160), near player at (288,160) → chases the NEAR one (right)
    stepZombies(g, zombies, meta, [player("a", 480, 160), player("b", 288, 160)], 1000);
    const z = zombies.get("z1");
    if (!z) throw new Error("zombie missing");
    expect(z.x).toBeCloseTo(160 + ZOMBIE_SPEED * DT, 4);
    expect(z.y).toBeCloseTo(160, 4);
    expect(z.vx).toBeCloseTo(ZOMBIE_SPEED, 4);
  });

  it("normalizes diagonal pursuit (speed is the vector magnitude)", () => {
    const g = makeGrid(20, 20);
    const { zombies, meta } = world([{ id: "z1", x: 160, y: 160 }]);
    stepZombies(g, zombies, meta, [player("a", 260, 260)], 1000);
    const z = zombies.get("z1");
    if (!z) throw new Error("zombie missing");
    const per = ZOMBIE_SPEED * Math.SQRT1_2 * DT;
    expect(z.x).toBeCloseTo(160 + per, 3);
    expect(z.y).toBeCloseTo(160 + per, 3);
  });

  it("slides along walls (shared move sweep)", () => {
    // Wall column tiles (6,5)+(6,6) span x [192,224), y [160,224). The zombie
    // chases a target beyond the wall: X pins at 192 − HW ≈ 184 while Y keeps
    // advancing — the wall-slide. 12 ticks ≈ 4.55 px each.
    const g = makeGrid(20, 20, [[6, 5], [6, 6]]);
    const { zombies, meta } = world([{ id: "z1", x: 176, y: 176 }]);
    for (let t = 0; t < 12; t += 1) {
      stepZombies(g, zombies, meta, [player("a", 320, 220)], 1000 + t * 50);
    }
    const z = zombies.get("z1");
    if (!z) throw new Error("zombie missing");
    expect(z.x).toBeGreaterThan(180);
    expect(z.x).toBeLessThan(184.01); // pinned at the wall face
    expect(z.y).toBeGreaterThan(185); // slid downward meanwhile
  });

  it("attacks in range on cooldown and stands still between attacks", () => {
    const g = makeGrid(20, 20);
    const { zombies, meta } = world([{ id: "z1", x: 160, y: 160 }]);
    const a = player("a", 160 + ZOMBIE_ATTACK_RANGE_PX - 1, 160);

    const first = stepZombies(g, zombies, meta, [a], 1000);
    expect(first).toEqual([{ victimId: "a", damage: ZOMBIE_ATTACK_DAMAGE, x: a.x, y: a.y }]);
    const z = zombies.get("z1");
    if (!z) throw new Error("zombie missing");
    expect(z.x).toBe(160); // no movement while in range
    expect(z.vx).toBe(0);

    const tooSoon = stepZombies(g, zombies, meta, [a], 1000 + ZOMBIE_ATTACK_COOLDOWN_MS - 50);
    expect(tooSoon).toEqual([]);

    const again = stepZombies(g, zombies, meta, [a], 1000 + ZOMBIE_ATTACK_COOLDOWN_MS);
    expect(again).toHaveLength(1);
  });

  it("does not attack immune players (chases, holds position in range)", () => {
    const g = makeGrid(20, 20);
    const { zombies, meta } = world([{ id: "z1", x: 160, y: 160 }]);
    const hits = stepZombies(g, zombies, meta, [player("a", 170, 160, true)], 1000);
    expect(hits).toEqual([]);
  });

  it("stands still with no players", () => {
    const g = makeGrid(20, 20);
    const { zombies, meta } = world([{ id: "z1", x: 160, y: 160 }]);
    const hits = stepZombies(g, zombies, meta, [], 1000);
    expect(hits).toEqual([]);
    const z = zombies.get("z1");
    if (!z) throw new Error("zombie missing");
    expect(z.x).toBe(160);
    expect(z.vx).toBe(0);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/zombies.test.ts`
Expected: FAIL — `../sim/zombies.js` does not exist.

- [ ] **Step 6: Create `server/src/sim/zombies.ts`**

```ts
import type { MapSchema } from "@colyseus/schema";
import {
  TICK_MS,
  ZOMBIE_SPEED,
  ZOMBIE_ATTACK_DAMAGE,
  ZOMBIE_ATTACK_COOLDOWN_MS,
  ZOMBIE_ATTACK_RANGE_PX,
  move,
  type SolidityGrid,
} from "@genzed/shared";
import type { Zombie } from "../schema/ArenaState.js";
import type { Target } from "./bullets.js";

export type ZombieMeta = { nextAttackAt: number };

export type ZombieAttack = { victimId: string; damage: number; x: number; y: number };

// One 20 Hz step for every zombie: retarget the NEAREST player (spec deviation
// 1 — legacy selected the farthest), greedy-steer through the shared player
// sweep (wall sliding for free; 4.55 px/tick is well under move()'s 32 px
// precondition), stand still in attack range and swing on a 1 s cooldown.
// Attacks skip immune players (legacy receiveDamage returned early on immune).
export function stepZombies(
  grid: SolidityGrid,
  zombies: MapSchema<Zombie>,
  meta: Map<string, ZombieMeta>,
  players: Target[],
  now: number,
): ZombieAttack[] {
  const attacks: ZombieAttack[] = [];
  const dt = TICK_MS / 1000;
  zombies.forEach((z, id) => {
    const m = meta.get(id);
    if (!m) return;
    let target: Target | null = null;
    let best = Infinity;
    for (const p of players) {
      const d2 = (p.x - z.x) ** 2 + (p.y - z.y) ** 2;
      if (d2 < best) {
        best = d2;
        target = p;
      }
    }
    if (!target) {
      z.vx = 0;
      return;
    }
    const dist = Math.sqrt(best);
    if (dist <= ZOMBIE_ATTACK_RANGE_PX) {
      z.vx = 0;
      if (!target.immune && now >= m.nextAttackAt) {
        m.nextAttackAt = now + ZOMBIE_ATTACK_COOLDOWN_MS;
        attacks.push({ victimId: target.id, damage: ZOMBIE_ATTACK_DAMAGE, x: target.x, y: target.y });
      }
      return;
    }
    const vx = ((target.x - z.x) / dist) * ZOMBIE_SPEED;
    const vy = ((target.y - z.y) / dist) * ZOMBIE_SPEED;
    const pos = move(grid, z.x, z.y, vx * dt, vy * dt);
    z.x = pos.x;
    z.y = pos.y;
    z.vx = vx;
  });
  return attacks;
}
```

- [ ] **Step 7: Run the test, then full gates**

Run: `pnpm -C server exec vitest run src/__tests__/zombies.test.ts`
Expected: 6 passing.

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean (the `kind`/`victimKind` extension is consumed only by updated code).

- [ ] **Step 8: Commit**

```bash
git add server/src
git commit -m "feat(server): bullet targets gain kind; zombie sim with nearest-target steering and cooldown attacks"
```

---

### Task 5: Room wiring — spawner, zombie tick, kill resolution, dev toggle

**Files:**
- Modify: `server/src/rooms/ArenaRoom.ts`
- Test: `server/src/__tests__/arenaWorld.test.ts` (zombie half)

- [ ] **Step 1: Wire zombies into `server/src/rooms/ArenaRoom.ts`**

(a) Extend the `@genzed/shared` import list with:

```ts
  EVT_ZOMBIE_ATTACK,
  MSG_DEV_ZOMBIE_SPAWNING,
  MSG_DEV_SPAWN_ZOMBIE,
  ZOMBIE_SPAWN_INTERVAL_MS,
  ZOMBIE_MAX_ALIVE,
  ZOMBIE_SPAWN_POINTS,
  type ZombieAttackEvent,
  type DevZombieSpawningMessage,
```

and the schema/sim imports:

```ts
import { ArenaState, Player, Bullet, Zombie } from "../schema/ArenaState.js";
import { stepZombies, type ZombieMeta } from "../sim/zombies.js";
```

(b) Add a module-scope validator next to the other `is*Message` guards:

```ts
function isDevZombieSpawningMessage(m: unknown): m is DevZombieSpawningMessage {
  if (typeof m !== "object" || m === null) return false;
  return typeof (m as Record<string, unknown>).enabled === "boolean";
}
```

(c) Add class fields (next to `bulletMeta`):

```ts
  private zombieMeta = new Map<string, ZombieMeta>();
  private zombieCounter = 0;
  private zombieSpawning = true; // dev seam can disable for E2E determinism
  private nextZombieSpawnTick = 0; // anchored at game start (state.tick never resets)
```

(d) Register both dev messages inside the existing `NODE_ENV !== "production"` block in `onCreate`:

```ts
      this.onMessage(MSG_DEV_ZOMBIE_SPAWNING, (_client, message: unknown) => {
        if (!isDevZombieSpawningMessage(message)) return;
        this.zombieSpawning = message.enabled;
        if (!message.enabled) {
          this.state.zombies.clear();
          this.zombieMeta.clear();
        }
      });
      this.onMessage(MSG_DEV_SPAWN_ZOMBIE, (_client, message: unknown) => {
        if (this.state.phase !== "playing") return;
        if (!isDevTeleportMessage(message)) return; // same { x, y } finite-number shape
        this.spawnZombieAt(message.x, message.y);
      });
```

(e) Add the spawn-tick constant next to `MAX_INPUTS_PER_TICK`:

```ts
const ZOMBIE_SPAWN_TICKS = ZOMBIE_SPAWN_INTERVAL_MS / TICK_MS; // 80 ticks = 4 s
```

(f) In `tick()`, after the player-targets loop (which gained `kind: "player"` in Task 4), bullets also collide with zombies:

```ts
    this.state.zombies.forEach((z, id) => {
      targets.push({ id, x: z.x, y: z.y, immune: false, kind: "zombie" });
    });
```

(g) After the bullet-hit loop in `tick()` (still inside the method), append steps 3–4 of the spec's tick order:

```ts
    if (this.state.phase !== "playing") return; // a bullet kill may have ended the game

    // 3. Zombies: retarget nearest, steer, attack.
    const playerTargets = targets.filter((t) => t.kind === "player");
    const attacks = stepZombies(this.grid, this.state.zombies, this.zombieMeta, playerTargets, now);
    for (const attack of attacks) {
      const victim = this.state.players.get(attack.victimId);
      if (!victim) continue;
      // playerTargets carries pre-bullet immune flags — a bullet kill this
      // same tick already respawned (and immunized) the victim; re-check.
      if (victim.immuneUntil > now) continue;
      victim.hp = Math.max(0, victim.hp - attack.damage); // uint8 — never assign negative
      const evt: ZombieAttackEvent = { x: attack.x, y: attack.y };
      this.broadcast(EVT_ZOMBIE_ATTACK, evt);
      // Zombie kills: respawn only — no feed line, no credit (legacy-verified, addendum 4).
      if (victim.hp === 0) this.respawn(victim, now);
    }

    // 4a. Zombie spawner: one per interval up to the cap. Anchored to a
    // next-spawn tick set at game start — state.tick never resets across
    // games, so a modulo check would drift later games' first spawn.
    if (this.zombieSpawning && this.state.tick >= this.nextZombieSpawnTick) {
      this.nextZombieSpawnTick = this.state.tick + ZOMBIE_SPAWN_TICKS;
      if (this.state.zombies.size < ZOMBIE_MAX_ALIVE) this.spawnZombie();
    }
```

(Note: the bullet-hit loop's `break` on phase change already exists; the early return above replaces relying on it for the new steps.)

(h) Add the spawn helper and zombie kill resolution. New method:

```ts
  private spawnZombie(): void {
    const p = ZOMBIE_SPAWN_POINTS[Math.floor(Math.random() * ZOMBIE_SPAWN_POINTS.length)];
    if (!p) return; // noUncheckedIndexedAccess; unreachable (non-empty table)
    this.spawnZombieAt(p.x, p.y);
  }

  private spawnZombieAt(x: number, y: number): void {
    const zombie = new Zombie();
    zombie.x = x;
    zombie.y = y;
    const id = `z${this.zombieCounter}`;
    this.zombieCounter += 1;
    this.state.zombies.set(id, zombie);
    this.zombieMeta.set(id, { nextAttackAt: 0 });
  }
```

and in `resolveHit`, FIRST thing in the method (before the victim lookup):

```ts
    if (hit.victimKind === "zombie") {
      // One-hit-kill, no credit, no feed line (spec). Client plays the corpse anim.
      this.state.zombies.delete(hit.victimId);
      this.zombieMeta.delete(hit.victimId);
      return;
    }
```

(i) Immunize the 4A combat tests against the spawner. In `server/src/__tests__/arenaCombat.test.ts`'s `startedGame()`, after the two `onMessage("*")` swallow lines, add (and import `MSG_DEV_ZOMBIE_SPAWNING`):

```ts
  c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false }); // 4B: keep zombies out of PvP fixtures
```

(Messages on one connection process in order, so this lands before `MSG_START_GAME`. Without it the longest fixtures run ~3.5 s of playing time against the 4 s first spawn — too thin a margin on a loaded runner, and `(400,400)` spawns 23 px from the `(384,416)` fixture. This repo has CI-flake scar tissue; spend the one line.)

(j) Lifecycle resets — zombies are game-scoped. In `assignSpawns()` (after `this.state.bullets.clear()`):

```ts
    this.state.zombies.clear();
    this.zombieMeta.clear();
    this.nextZombieSpawnTick = this.state.tick + ZOMBIE_SPAWN_TICKS;
```

In `handleWin()` (after `this.bulletMeta.clear()`) — calm banner screen:

```ts
    this.state.zombies.clear();
    this.zombieMeta.clear();
```

In `resetToLobby()` (after `this.bulletMeta.clear()`):

```ts
    this.state.zombies.clear();
    this.zombieMeta.clear();
```

- [ ] **Step 2: Write the zombie half of `server/src/__tests__/arenaWorld.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_END_GAME,
  MSG_FIRE,
  MSG_DEV_ZOMBIE_SPAWNING,
  MSG_DEV_SPAWN_ZOMBIE,
  EVT_ZOMBIE_ATTACK,
  ZOMBIE_SPAWN_POINTS,
  ZOMBIE_ATTACK_DAMAGE,
  type ZombieAttackEvent,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  c1.onMessage("*", () => {});
  c2.onMessage("*", () => {});
  c1.send(MSG_START_GAME);
  await sleep(3300);
  expect(room.state.phase).toBe("playing");
  const p1 = room.state.players.get(c1.sessionId);
  const p2 = room.state.players.get(c2.sessionId);
  if (!p1 || !p2) throw new Error("players missing");
  return { room, c1, c2, p1, p2 };
}

describe("zombie spawner + combat", () => {
  it("spawns naturally on the interval at a table point; dev toggle clears and stops", async () => {
    const { room, c1 } = await startedGame();
    await sleep(4300); // first spawn lands at tick 80 (4 s)
    expect(room.state.zombies.size).toBeGreaterThanOrEqual(1);
    const z = [...room.state.zombies.values()][0];
    if (!z) throw new Error("zombie missing");
    // Spawned AT a table point — by now it has chased, so check it spawned near one.
    const near = ZOMBIE_SPAWN_POINTS.some((p) => Math.hypot(p.x - z.x, p.y - z.y) < 200);
    expect(near).toBe(true);
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false });
    await sleep(150);
    expect(room.state.zombies.size).toBe(0);
    await sleep(4200); // a full interval passes — nothing respawns
    expect(room.state.zombies.size).toBe(0);
  }, 20_000);

  it("zombie closes on the nearest player and attacks for 5 on a 1 s cadence", async () => {
    const { room, c1, c2, p1, p2 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false }); // no strays
    const attacks: ZombieAttackEvent[] = [];
    c2.onMessage(EVT_ZOMBIE_ATTACK, (m: ZombieAttackEvent) => attacks.push(m));
    await sleep(150);
    // VERIFIED fixture (player grid): the corridor y=128, x 128..200 is
    // AABB-clear — the zombie has a straight walk to the player.
    p1.x = 128;
    p1.y = 128;
    p1.immuneUntil = 0;
    p2.x = 992;
    p2.y = 992; // far away — the zombie must pick p1 (nearest)
    c1.send(MSG_DEV_SPAWN_ZOMBIE, { x: 188, y: 128 }); // dev seam plants meta too
    await sleep(150);
    const zombie = [...room.state.zombies.values()][0];
    if (!zombie) throw new Error("dev spawn failed");
    const startDist = Math.hypot(zombie.x - p1.x, zombie.y - p1.y); // ≤60 px (it may have stepped)
    await sleep(450); // ~8 ticks at 91 px/s ≈ 36 px closer
    expect(Math.hypot(zombie.x - p1.x, zombie.y - p1.y)).toBeLessThan(startDist);
    await sleep(1600); // reaches 28 px range (~0.4 s in) and swings at least once
    expect(p1.hp).toBeLessThanOrEqual(100 - ZOMBIE_ATTACK_DAMAGE);
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    expect(attacks.length).toBeLessThanOrEqual(4); // 1/s cadence (~2 s in range + runner-stall slack); unthrottled would be ~40
  }, 20_000);

  it("one bullet kills a zombie, awards nothing, and the bullet is consumed", async () => {
    const { room, c1, p1, p2 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false });
    await sleep(150);
    // VERIFIED fixture: the y=128 ray is clear across the row on the BULLET
    // grid, while the player-grid tile (7,3) stops the chasing zombie at
    // x≈264 — it can never reach the shooter, it dies on the firing line.
    p1.x = 128;
    p1.y = 128;
    p2.x = 992;
    p2.y = 992; // out of the line of fire
    c1.send(MSG_DEV_SPAWN_ZOMBIE, { x: 300, y: 128 });
    await sleep(150);
    expect(room.state.zombies.size).toBe(1);
    c1.send(MSG_FIRE, { tx: 300, ty: 128 });
    await sleep(700); // ≤172 px at 500 px/s + tick slack; zombie closes toward the line
    expect(room.state.zombies.size).toBe(0);
    expect(room.state.bullets.size).toBe(0);
    expect(p1.gunLevel).toBe(1); // no credit for zombie kills
    expect(p1.hp).toBe(100); // the wall-stuck zombie never reached attack range
  }, 20_000);

  it("game-start and win/reset clear zombies", async () => {
    const { room, c1 } = await startedGame();
    await sleep(4300);
    expect(room.state.zombies.size).toBeGreaterThanOrEqual(1);
    c1.send(MSG_END_GAME); // dev reset seam (pre-existing)
    await sleep(200);
    expect(room.state.phase).toBe("lobby");
    expect(room.state.zombies.size).toBe(0);
  }, 20_000);
});
```

Implementation note: zombie fixtures go through `MSG_DEV_SPAWN_ZOMBIE` (which plants the cooldown meta the spawner would), so no private-field casts are needed. The `Zombie` import in this file is then only needed if a test constructs one directly — drop it if unused, or the lint gate fails.

- [ ] **Step 3: Run the new tests, then full gates**

Run: `pnpm -C server exec vitest run src/__tests__/arenaWorld.test.ts`
Expected: 4 passing (~25 s — real sleeps).

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. `arenaCombat.test.ts` must still pass untouched — its fixtures finish before natural zombies (spawned ≥200 px away, 91 px/s) can reach them and chip hp.

- [ ] **Step 4: Commit**

```bash
git add server/src
git commit -m "feat(server): zombie spawner, chase/attack tick, bullet kill resolution, dev spawning toggle"
```

---

### Task 6: Pickups — effects, collection, respawn cycling, speed-bonus threading

**Files:**
- Create: `server/src/sim/pickups.ts`
- Test: `server/src/__tests__/pickups.test.ts`
- Modify: `server/src/rooms/ArenaRoom.ts`
- Modify: `server/src/__tests__/arenaWorld.test.ts` (pickup describe)

The speed pickup threads through the EXISTING `Player.speedBonus` sim field — `speedBonus` is part of `PlayerSim`, schema-synced, and rebased by reconcile, so **client prediction needs zero new code** (brief ~RTT under-prediction at pickup/expiry, smoothed by the existing snap-lerp; same accepted class as the 4A L5 note). The one 4A line that must change: `resolveHit` recomputes `speedBonus` on level-up — it must preserve a live pickup boost instead of overwriting with the L5-only value.

- [ ] **Step 1: Write the failing helper tests** — `server/src/__tests__/pickups.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { PLAYER_W, PLAYER_H } from "@genzed/shared";
import { applyHealthPickup, overlapsPickup, pickRespawnSlot } from "../sim/pickups.js";

describe("applyHealthPickup (legacy managePickups.js:84-87)", () => {
  it("adds 30 below the 70 threshold", () => {
    expect(applyHealthPickup(0)).toBe(30);
    expect(applyHealthPickup(50)).toBe(80);
    expect(applyHealthPickup(69)).toBe(99);
  });
  it("sets to 100 at/above the threshold", () => {
    expect(applyHealthPickup(70)).toBe(100);
    expect(applyHealthPickup(95)).toBe(100);
    expect(applyHealthPickup(100)).toBe(100);
  });
});

describe("overlapsPickup (player AABB vs 32×32 pickup box)", () => {
  const HW = PLAYER_W / 2;
  const HH = PLAYER_H / 2;
  it("overlaps inside the combined half-extents and not outside", () => {
    expect(overlapsPickup(100, 100, 100, 100)).toBe(true);
    expect(overlapsPickup(100 + HW + 16 - 1, 100, 100, 100)).toBe(true);
    expect(overlapsPickup(100 + HW + 16 + 1, 100, 100, 100)).toBe(false);
    expect(overlapsPickup(100, 100 + HH + 16 - 1, 100, 100)).toBe(true);
    expect(overlapsPickup(100, 100 + HH + 16 + 1, 100, 100)).toBe(false);
  });
});

describe("pickRespawnSlot", () => {
  it("returns an unoccupied slot index", () => {
    const occupied = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let i = 0; i < 20; i += 1) {
      expect(pickRespawnSlot(occupied)).toBe(10); // only free slot
    }
  });
  it("returns -1 when everything is occupied (defensive; unreachable with ≤4 pickups)", () => {
    expect(pickRespawnSlot(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(-1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C server exec vitest run src/__tests__/pickups.test.ts`
Expected: FAIL — `../sim/pickups.js` does not exist.

- [ ] **Step 3: Create `server/src/sim/pickups.ts`**

```ts
import {
  PLAYER_W,
  PLAYER_H,
  PLAYER_HEALTH,
  HEALTH_PICKUP_HP,
  HEALTH_PICKUP_CAP_THRESHOLD,
  PICKUP_SLOTS,
} from "@genzed/shared";

// Legacy rule: at/above 70 hp a health pack tops you off; below, +30 (max 99).
export function applyHealthPickup(hp: number): number {
  return hp >= HEALTH_PICKUP_CAP_THRESHOLD ? PLAYER_HEALTH : hp + HEALTH_PICKUP_HP;
}

const PICKUP_HALF = 16; // heart.png/speed.png are 32×32; one box for both kinds

export function overlapsPickup(px: number, py: number, kx: number, ky: number): boolean {
  return Math.abs(px - kx) <= PLAYER_W / 2 + PICKUP_HALF && Math.abs(py - ky) <= PLAYER_H / 2 + PICKUP_HALF;
}

// Random unoccupied slot (legacy re-rolled in a do-while; filtering is the
// same distribution without the unbounded loop). -1 = none free (unreachable
// with ≤4 live pickups against 11 slots, but indexed access must stay safe).
export function pickRespawnSlot(occupied: ReadonlySet<number>): number {
  const free: number[] = [];
  for (let i = 0; i < PICKUP_SLOTS.length; i += 1) {
    if (!occupied.has(i)) free.push(i);
  }
  const pick = free[Math.floor(Math.random() * free.length)];
  return pick ?? -1;
}
```

Run: `pnpm -C server exec vitest run src/__tests__/pickups.test.ts`
Expected: 5 passing.

- [ ] **Step 4: Wire pickups into `server/src/rooms/ArenaRoom.ts`**

(a) Imports — extend the `@genzed/shared` list:

```ts
  PICKUP_KIND_HEALTH,
  SPEED_PICKUP_BONUS,
  SPEED_PICKUP_MS,
  PICKUP_RESPAWN_MS,
  PICKUP_SLOTS,
  PICKUP_INITIAL,
```

(`PICKUP_KIND_SPEED` is deliberately NOT imported — every branch compares against `PICKUP_KIND_HEALTH`, and `no-unused-vars` is a lint error.)

schema/sim imports:

```ts
import { ArenaState, Player, Bullet, Zombie, Pickup } from "../schema/ArenaState.js";
import { applyHealthPickup, overlapsPickup, pickRespawnSlot } from "../sim/pickups.js";
```

(b) `CombatMeta` gains the boost timer; `freshCombatMeta()` initializes it:

```ts
  speedBoostUntil: number; // server-clock ms; 0 = no speed pickup active
```

```ts
    speedBoostUntil: 0,
```

(c) Module-scope helper (next to `freshCombatMeta`):

```ts
// speedBonus is the SUM of its two sources — the L5 gun bonus and a live
// speed pickup. Every write to player.speedBonus goes through here so one
// source can't clobber the other.
function computeSpeedBonus(player: Player, speedBoostUntil: number, now: number): number {
  return (
    (player.gunLevel === 5 ? GUN_L5_SPEED_BONUS : 0) + (speedBoostUntil > now ? SPEED_PICKUP_BONUS : 0)
  );
}
```

(d) Class fields (next to `zombieMeta`):

```ts
  private pickupSlotById = new Map<string, number>(); // live pickup id → slot index
  private pickupCounter = 0;
  private pickupRespawns: Array<{ kind: number; at: number }> = [];
```

(e) Placement helper (next to `spawnZombie`):

```ts
  private placePickup(kind: number, slot: number): void {
    const s = PICKUP_SLOTS[slot];
    if (!s) return; // noUncheckedIndexedAccess; slot indices come from the table
    const pickup = new Pickup();
    pickup.x = s.x;
    pickup.y = s.y;
    pickup.kind = kind;
    const id = `p${this.pickupCounter}`;
    this.pickupCounter += 1;
    this.state.pickups.set(id, pickup);
    this.pickupSlotById.set(id, slot);
  }
```

(f) In `assignSpawns()` (with the other game-scoped resets):

```ts
    this.state.pickups.clear();
    this.pickupSlotById.clear();
    this.pickupRespawns = [];
    for (const init of PICKUP_INITIAL) this.placePickup(init.kind, init.slot);
```

(g) In `resetToLobby()` (after the zombie clears):

```ts
    this.state.pickups.clear();
    this.pickupSlotById.clear();
    this.pickupRespawns = [];
```

(`handleWin` leaves pickups in place deliberately — the tick stops in `"ended"`, so they're inert scenery under the banner.)

(h) Speed-boost expiry rides the existing per-player meta loop in `tick()` (the one that completes reloads). Add inside it:

```ts
      if (meta.speedBoostUntil > 0 && now >= meta.speedBoostUntil) {
        meta.speedBoostUntil = 0;
        player.speedBonus = computeSpeedBonus(player, 0, now);
      }
```

(i) New tick step after the zombie spawner (step 4b):

```ts
    // 4b. Pickups: collection by player-AABB overlap, then respawn timers.
    this.tickPickups(now);
```

and the method:

```ts
  private tickPickups(now: number): void {
    // Collection — first overlapping player wins; immune players may collect
    // (legacy overlap had no immunity check).
    const collected: string[] = [];
    this.state.pickups.forEach((pickup, id) => {
      let taken = false;
      this.state.players.forEach((player, sessionId) => {
        if (taken || !overlapsPickup(player.x, player.y, pickup.x, pickup.y)) return;
        const meta = this.combat.get(sessionId);
        if (!meta) return;
        taken = true;
        if (pickup.kind === PICKUP_KIND_HEALTH) {
          player.hp = applyHealthPickup(player.hp);
          this.broadcastLog("pickup", `${player.name} has picked up a health pack!`);
        } else {
          meta.speedBoostUntil = now + SPEED_PICKUP_MS; // refreshes, never stacks (deviation 4)
          player.speedBonus = computeSpeedBonus(player, meta.speedBoostUntil, now);
          this.broadcastLog("pickup", `${player.name} has picked up a speed boost!`);
        }
        this.pickupRespawns.push({ kind: pickup.kind, at: now + PICKUP_RESPAWN_MS });
      });
      if (taken) collected.push(id);
    });
    for (const id of collected) {
      this.state.pickups.delete(id);
      this.pickupSlotById.delete(id);
    }
    // Respawns due → random unoccupied slot (legacy strings).
    if (this.pickupRespawns.length > 0) {
      const due = this.pickupRespawns.filter((r) => now >= r.at);
      this.pickupRespawns = this.pickupRespawns.filter((r) => now < r.at);
      for (const r of due) {
        const occupied = new Set(this.pickupSlotById.values());
        const slot = pickRespawnSlot(occupied);
        if (slot === -1) continue;
        this.placePickup(r.kind, slot);
        const item = r.kind === PICKUP_KIND_HEALTH ? "health pack" : "speed boost";
        this.broadcastLog("pickup", `A new ${item} has been placed!`);
      }
    }
  }
```

(j) **Fix the 4A level-up line in `resolveHit`** — replace:

```ts
    shooter.speedBonus = shooter.gunLevel === 5 ? GUN_L5_SPEED_BONUS : 0;
```

with:

```ts
    const shooterMeta = this.combat.get(hit.shooterId);
    shooter.speedBonus = computeSpeedBonus(shooter, shooterMeta?.speedBoostUntil ?? 0, now);
```

- [ ] **Step 5: Append the pickup describe to `server/src/__tests__/arenaWorld.test.ts`**

Add to the existing imports: `PICKUP_KIND_HEALTH`, `PICKUP_SLOTS`, `SPEED_PICKUP_BONUS`, `EVT_LOG`, `type LogEvent` (from `@genzed/shared`). (Not `PICKUP_KIND_SPEED` — unused here, lint error.)

```ts
describe("pickups", () => {
  it("places the legacy initial layout when the game starts", async () => {
    const { room } = await startedGame();
    expect(room.state.pickups.size).toBe(4);
    const byKind = { health: [] as string[], speed: [] as string[] };
    room.state.pickups.forEach((p) => {
      const key = `${p.x},${p.y}`;
      if (p.kind === PICKUP_KIND_HEALTH) byKind.health.push(key);
      else byKind.speed.push(key);
    });
    // PICKUP_SLOTS is an as-const tuple — literal indexing is exact-typed.
    const slot = (s: { x: number; y: number }) => `${s.x},${s.y}`;
    expect(byKind.health.sort()).toEqual([slot(PICKUP_SLOTS[4]), slot(PICKUP_SLOTS[1])].sort());
    expect(byKind.speed.sort()).toEqual([slot(PICKUP_SLOTS[6]), slot(PICKUP_SLOTS[8])].sort());
  }, 10_000);

  it("health pack: +30 below 70, top-off at/above 70, feed line, pickup consumed", async () => {
    const { room, c1, c2, p1 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false }); // no hp interference
    const logs: LogEvent[] = [];
    c2.onMessage(EVT_LOG, (m: LogEvent) => logs.push(m));
    await sleep(150);
    p1.hp = 50;
    p1.x = PICKUP_SLOTS[4].x; // health slot (as-const tuple: literal index is exact-typed)
    p1.y = PICKUP_SLOTS[4].y;
    await sleep(150);
    expect(p1.hp).toBe(80);
    expect(room.state.pickups.size).toBe(3);
    expect(logs.some((l) => l.kind === "pickup" && l.text === "a has picked up a health pack!")).toBe(true);
    // Second health pack at/above threshold tops off.
    p1.hp = 75;
    p1.x = PICKUP_SLOTS[1].x;
    p1.y = PICKUP_SLOTS[1].y;
    await sleep(150);
    expect(p1.hp).toBe(100);
  }, 10_000);

  it("speed boost applies 100, refreshes (not stacks), expires to the gun bonus, and respawns", async () => {
    const { room, c1, p1 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false });
    await sleep(150);
    p1.x = PICKUP_SLOTS[6].x; // speed slot
    p1.y = PICKUP_SLOTS[6].y;
    await sleep(150);
    expect(p1.speedBonus).toBe(SPEED_PICKUP_BONUS);
    expect(room.state.pickups.size).toBe(3);
    // Walk onto the second speed pickup mid-boost: still 100, never 200.
    p1.x = PICKUP_SLOTS[8].x;
    p1.y = PICKUP_SLOTS[8].y;
    await sleep(150);
    expect(p1.speedBonus).toBe(SPEED_PICKUP_BONUS);
    p1.x = 128; // step off the slots so respawns aren't instantly re-collected
    p1.y = 128;
    // Expiry: refreshed at the second collect → 0 again ~5 s later.
    await sleep(5300);
    expect(p1.speedBonus).toBe(0);
    // Respawn: first collect + 8 s — by now it's due; count returns to 4.
    await sleep(3000);
    expect(room.state.pickups.size).toBe(4);
  }, 20_000);
});
```

- [ ] **Step 6: Run, then full gates**

Run: `pnpm -C server exec vitest run src/__tests__/arenaWorld.test.ts && pnpm -C server exec vitest run src/__tests__/pickups.test.ts`
Expected: all passing (the speed test alone is ~12 s of real sleeps).

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean — the L5 test in `arenaCombat.test.ts` still passes: with no pickup active, `computeSpeedBonus` returns exactly the old L5-only value.

- [ ] **Step 7: Commit**

```bash
git add server/src
git commit -m "feat(server): pickups — legacy slots, health/speed effects, respawn cycling, speedBonus composition"
```

---

### Task 7: Chat relay — server side

**Files:**
- Modify: `server/src/rooms/ArenaRoom.ts`
- Modify: `server/src/__tests__/arenaWorld.test.ts` (chat describe)

Pure relay with gates: ≤200 chars (trimmed), 1/s per player, `playing`/`ended` phases only. No history — late joiners see nothing (matches legacy).

- [ ] **Step 1: Wire into `server/src/rooms/ArenaRoom.ts`**

(a) Imports: `MSG_CHAT`, `CHAT_MAX_LEN`, `CHAT_INTERVAL_MS`, `EVT_CHAT`, `type ChatMessage`, `type ChatEvent`.

(b) `CombatMeta` gains `nextChatAt: number;`, `freshCombatMeta()` gains `nextChatAt: 0,`.

(c) Module-scope guard:

```ts
function isChatMessage(m: unknown): m is ChatMessage {
  if (typeof m !== "object" || m === null) return false;
  return typeof (m as Record<string, unknown>).text === "string";
}
```

(d) Register in `onCreate` (unconditional — not a dev seam):

```ts
    this.onMessage(MSG_CHAT, (client, message: unknown) => this.handleChat(client, message));
```

(e) Handler:

```ts
  private handleChat(client: Client, message: unknown): void {
    if (this.state.phase !== "playing" && this.state.phase !== "ended") return;
    if (!isChatMessage(message)) return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    const text = message.text.trim();
    if (text.length === 0 || text.length > CHAT_MAX_LEN) return;
    const now = Date.now();
    if (now < meta.nextChatAt) return; // 1/s per player
    meta.nextChatAt = now + CHAT_INTERVAL_MS;
    const evt: ChatEvent = { name: player.name, text };
    this.broadcast(EVT_CHAT, evt);
  }
```

- [ ] **Step 2: Append the chat describe to `server/src/__tests__/arenaWorld.test.ts`**

Add imports: `MSG_CHAT`, `EVT_CHAT`, `type ChatEvent`.

```ts
describe("chat relay", () => {
  it("broadcasts trimmed lines with the sender name; gates length, rate, and phase", async () => {
    const { c1, c2 } = await startedGame();
    const lines: ChatEvent[] = [];
    c2.onMessage(EVT_CHAT, (m: ChatEvent) => lines.push(m));
    await sleep(150);
    c1.send(MSG_CHAT, { text: "  gg  " });
    c1.send(MSG_CHAT, { text: "too fast" }); // inside the 1 s window — dropped
    c1.send(MSG_CHAT, { text: "x".repeat(201) }); // too long — dropped
    c1.send(MSG_CHAT, { text: "   " }); // empty after trim — dropped
    c1.send(MSG_CHAT, 42); // malformed — dropped
    await sleep(250);
    expect(lines).toEqual([{ name: "a", text: "gg" }]);
    await sleep(1000); // rate window passes
    c1.send(MSG_CHAT, { text: "round two" });
    await sleep(250);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ name: "a", text: "round two" });
    // Phase gate: back in the lobby, chat is dropped.
    c1.send(MSG_END_GAME);
    await sleep(200);
    c1.send(MSG_CHAT, { text: "lobby talk" });
    await sleep(250);
    expect(lines).toHaveLength(2);
  }, 15_000);
});
```

- [ ] **Step 3: Run, then full gates**

Run: `pnpm -C server exec vitest run src/__tests__/arenaWorld.test.ts`
Expected: all passing.

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/src
git commit -m "feat(server): chat relay with length/rate/phase gates"
```

---

### Task 8: Client zombies — rendering, corpse, sounds, E2E hooks

**Files:**
- Modify: `client/src/game/animations.ts`
- Modify: `client/src/game/scenes/ArenaScene.ts`

- [ ] **Step 1: Zombie animations in `client/src/game/animations.ts`**

Add below the existing exports:

```ts
export const ZOMBIE_ATLAS = "zombie";

export const ZOMBIE_ANIM = {
  walk: "zombie-walk",
  dead: "zombie-dead",
} as const;

// Legacy enemy.js:9-10 numeric indices resolved against zombieSheet.json hash
// order (verified during planning — do not re-derive). 9 fps both. The art
// faces LEFT natively; the scene sets flipX when vx > 0.
const ZOMBIE_WALK_FRAMES = [
  "zombieWalk1.png",
  "zombieWalk2.png",
  "zombieWalk3.png",
  "zombieWalk4.png",
  "zombieWalk1.png",
  "zombieWalk5 (1).png",
  "zombieWalk7 (1).png",
];

const ZOMBIE_DEAD_FRAMES = [
  "zombieDeath2.png",
  "zombieDeath3.png",
  "zombieDeath4.png",
  "zombieDeath5.png",
  "zombieDeath6.png",
  "zombieDeath7 (1).png",
  "zombieDeath8.png",
  "zombieDeath9.png",
  "zombieDeath10.png",
];

export function registerZombieAnimations(scene: Phaser.Scene): void {
  if (!scene.anims.exists(ZOMBIE_ANIM.walk)) {
    scene.anims.create({
      key: ZOMBIE_ANIM.walk,
      frames: ZOMBIE_WALK_FRAMES.map((frame) => ({ key: ZOMBIE_ATLAS, frame })),
      frameRate: 9,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(ZOMBIE_ANIM.dead)) {
    scene.anims.create({
      key: ZOMBIE_ANIM.dead,
      frames: ZOMBIE_DEAD_FRAMES.map((frame) => ({ key: ZOMBIE_ATLAS, frame })),
      frameRate: 9,
      repeat: 0,
    });
  }
}
```

- [ ] **Step 2: Wire zombies into `client/src/game/scenes/ArenaScene.ts`**

(a) Imports. From `@genzed/shared` add: `MSG_DEV_ZOMBIE_SPAWNING`, `MSG_DEV_SPAWN_ZOMBIE`, `EVT_ZOMBIE_ATTACK`, `ZOMBIE_CORPSE_MS`, `type ZombieAttackEvent`. From `../animations.js` add: `ZOMBIE_ATLAS`, `ZOMBIE_ANIM`, `registerZombieAnimations`. From `../../lobby/arenaState.js` add: `ZombieView`.

(b) View type + map (next to `BulletSpriteView` / `bulletViews`):

```ts
type ZombieSpriteView = {
  zombie: ZombieView; // live schema ref
  sprite: Phaser.GameObjects.Sprite;
  interp: RemoteInterpolation;
  unsubscribe: () => void;
};
```

```ts
  private zombieViews = new Map<string, ZombieSpriteView>();
  private nextGroanAt = 0; // legacy throttled the groan to one per 5 s
```

(c) The debug-hook type gains two members:

```ts
  zombies: () => Array<{ id: string; x: number; y: number }>;
  setZombieSpawning: (enabled: boolean) => void;
  spawnZombie: (x: number, y: number) => void;
```

(d) `preload()` additions:

```ts
    this.load.atlas(ZOMBIE_ATLAS, "assets/images/zombieSprite.png", "assets/images/zombieSheet.json");
    this.load.audio("zombieGroan", "assets/sounds/zombie.wav");
    this.load.audio("zombieAttack", "assets/sounds/zombieHit.wav");
```

(e) `create()` additions — after `registerPlayerAnimations(this);`:

```ts
    registerZombieAnimations(this);
```

In the schema-listener `unsubscribers.push(...)` block, add:

```ts
      this.room.state.zombies.onAdd((z, id) => {
        if (!this.zombieViews.has(id)) this.addZombie(id, z);
      }) as unknown as () => void,
      this.room.state.zombies.onRemove((_z, id) => this.removeZombie(id)) as unknown as () => void,
```

In the broadcast-handler `unsubscribers.push(...)` block, add:

```ts
      this.room.onMessage(EVT_ZOMBIE_ATTACK, (m: ZombieAttackEvent) => this.onZombieAttack(m)) as unknown as () => void,
```

In the `window.__arena` object, add:

```ts
      zombies: () =>
        [...this.zombieViews.entries()].map(([id, view]) => ({ id, x: view.sprite.x, y: view.sprite.y })),
      setZombieSpawning: (enabled: boolean) => void this.room.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled }),
      spawnZombie: (x: number, y: number) => void this.room.send(MSG_DEV_SPAWN_ZOMBIE, { x, y }),
```

(f) Add/remove methods (next to `addBullet`/`removeBullet`). The corpse is a client-local sprite playing the death anim at the removal position, destroyed after 4 s — exactly legacy's `killZombie` (`zombieGameState.js:527-554`):

```ts
  private addZombie(id: string, zombie: ZombieView): void {
    const sprite = this.add.sprite(zombie.x, zombie.y, ZOMBIE_ATLAS, "zombieWalk1.png").setDepth(5);
    sprite.play(ZOMBIE_ANIM.walk);
    const interp = new RemoteInterpolation();
    interp.push(zombie.x, zombie.y, 0);
    const unsubscribe = zombie.onChange(() => {
      interp.push(zombie.x, zombie.y, 0);
    }) as unknown as () => void;
    this.zombieViews.set(id, { zombie, sprite, interp, unsubscribe });
  }

  private removeZombie(id: string): void {
    const view = this.zombieViews.get(id);
    if (!view) return;
    view.unsubscribe();
    const corpse = this.add
      .sprite(view.sprite.x, view.sprite.y, ZOMBIE_ATLAS, "zombieDeath2.png")
      .setFlipX(view.sprite.flipX)
      .setDepth(5);
    corpse.play(ZOMBIE_ANIM.dead);
    this.time.delayedCall(ZOMBIE_CORPSE_MS, () => corpse.destroy());
    view.sprite.destroy();
    this.zombieViews.delete(id);
  }

  private onZombieAttack(evt: ZombieAttackEvent): void {
    // Same linear falloff as remote shots (legacy played it full-volume on one
    // arbitrary client — addendum 2).
    const me = this.views.get(this.localSessionId);
    if (!me) return;
    const distance = Math.hypot(evt.x - me.sprite.x, evt.y - me.sprite.y);
    const volume = 1 - (distance - 30) / 600;
    if (volume > 0) this.sound.play("zombieAttack", { volume: Math.min(1, volume) });
  }
```

(g) In `update()`, after the remote-players loop, drive zombie rendering + the proximity groan (legacy curve `1 - ((d - 30) / 150) - 0.2`, 5 s throttle, 0.8 cap — `enemy.js:42-52`):

```ts
    // Zombies: interpolated like remote players; art faces left → flipX when moving right.
    let nearestZombie = Infinity;
    this.zombieViews.forEach((view) => {
      const s = view.interp.sample();
      if (s) view.sprite.setPosition(s.x, s.y);
      view.sprite.setFlipX(view.zombie.vx > 0);
      if (local) {
        const d = Math.hypot(view.sprite.x - local.sprite.x, view.sprite.y - local.sprite.y);
        if (d < nearestZombie) nearestZombie = d;
      }
    });
    if (nearestZombie < Infinity && performance.now() >= this.nextGroanAt) {
      const perc = 1 - (nearestZombie - 30) / 150 - 0.2;
      const volume = perc > 1 ? 0.8 : perc;
      if (volume > 0) {
        this.sound.play("zombieGroan", { volume });
        this.nextGroanAt = performance.now() + 5000;
      }
    }
```

(`local` is the existing `this.views.get(this.localSessionId)` binding from the top of `update()` — reuse it, don't re-fetch.)

(h) `shutdown()` additions (next to the bulletViews cleanup):

```ts
    this.zombieViews.forEach((view) => safeUnsub(view.unsubscribe));
    this.zombieViews.clear();
```

- [ ] **Step 3: Gates + E2E regression (render-path change)**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && CI=1 pnpm test:e2e`
Expected: all green — the three existing specs still pass with zombies live in the world (movement/smoke are unaffected by zombie contact; combat's fixtures gain the spawning-off seam in Task 11, but its current poll-based assertions tolerate stray chip damage in the interim — if combat flakes here, note it and proceed; Task 11 fixes it properly).

- [ ] **Step 4: Manual dev check**

Run `pnpm dev`, join with two browsers, start a game. Expected: zombies appear within ~4 s, shamble toward the nearest player (left-facing art flips when moving right), groan within ~150 px, attack at contact (hp hearts drop, `zombieHit` plays), die to one bullet with the death animation lingering ~4 s.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): zombie rendering — interpolation, corpse anim, groan/attack sounds, E2E hooks"
```

---

### Task 9: Client pickups

**Files:**
- Modify: `client/src/game/scenes/ArenaScene.ts`

Pickups are static sprites driven purely by schema add/remove — no interpolation, no onChange. Feed lines already render via the existing `EVT_LOG` path.

- [ ] **Step 1: Wire into `ArenaScene.ts`**

(a) Import `PICKUP_KIND_SPEED` from `@genzed/shared`. (No `PickupView` import — the `onAdd` callback's param type is inferred from the `SchemaMap<PickupView>` mirror, and an unused named import fails lint.)

(b) Field:

```ts
  private pickupSprites = new Map<string, Phaser.GameObjects.Image>();
```

(c) `preload()`:

```ts
    this.load.image("heartPickup", "assets/images/heart.png");
    this.load.image("speedPickup", "assets/images/speed.png");
```

(d) Schema listeners (same `unsubscribers.push` block as the zombie ones):

```ts
      this.room.state.pickups.onAdd((p, id) => {
        if (this.pickupSprites.has(id)) return;
        const sprite = this.add
          .image(p.x, p.y, p.kind === PICKUP_KIND_SPEED ? "speedPickup" : "heartPickup")
          .setDepth(43); // above the Task-12 darkness layer — legacy rendered pickups full-bright
        if (p.kind === PICKUP_KIND_SPEED) sprite.setScale(0.5); // legacy pickups.js:26
        this.pickupSprites.set(id, sprite);
      }) as unknown as () => void,
      this.room.state.pickups.onRemove((_p, id) => {
        this.pickupSprites.get(id)?.destroy();
        this.pickupSprites.delete(id);
      }) as unknown as () => void,
```

(e) `shutdown()`:

```ts
    this.pickupSprites.forEach((sprite) => sprite.destroy());
    this.pickupSprites.clear();
```

- [ ] **Step 2: Gates + manual check**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. In `pnpm dev`: two hearts and two (half-size) speed icons at the legacy slots; walking over one consumes it, the feed announces it, hearts/speed take effect, and a replacement appears elsewhere ~8 s later.

- [ ] **Step 3: Commit**

```bash
git add client/src
git commit -m "feat(client): pickup sprites driven by schema add/remove"
```

---

### Task 10: Client chat — TAB overlay with input suppression

**Files:**
- Create: `client/src/game/ChatOverlay.tsx`
- Modify: `client/src/game/GameMount.tsx`
- Modify: `client/src/game/scenes/ArenaScene.ts`

Two halves that meet at one seam: the overlay sets `window.__chatOpen` (same window-global pattern as `__arena`); the scene reads it every input sample. While open: the scene sends **idle** inputs (so the server zeroes velocity AND prediction steps the identical idle input — the one-simulation invariant holds; legacy instead skipped its velocity-zeroing branch and slid, a bug we're not porting), suppresses fire/reload/roll, freezes aim, and releases Phaser's key captures so W/A/S/D/SPACE/R keydowns reach the DOM input instead of being `preventDefault`ed.

- [ ] **Step 1: Create `client/src/game/ChatOverlay.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { MSG_CHAT, EVT_CHAT, CHAT_MAX_LEN, type ChatEvent } from "@genzed/shared";
import { useRoom } from "../lobby/RoomContext.js";

const MAX_LINES = 8;

// TAB toggles (legacy bound chat to TAB, ESC to close — player.js:99-101);
// Enter sends and closes (legacy hid the chat container after submit).
// Messages render only while open, matching legacy's hidden container.
export function ChatOverlay(): JSX.Element | null {
  const { getRoom } = useRoom();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    // onMessage handlers accumulate on the Room across remounts — keep the detach.
    const detach = room.onMessage(EVT_CHAT, (m: ChatEvent) => {
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), m]);
    }) as unknown as () => void;
    return detach;
  }, [getRoom]);

  useEffect(() => {
    (window as unknown as { __chatOpen?: boolean }).__chatOpen = open;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Tab") {
        e.preventDefault(); // keep browser focus traversal out of the game
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (window as unknown as { __chatOpen?: boolean }).__chatOpen = false;
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (text.length > 0) getRoom()?.send(MSG_CHAT, { text });
      setDraft("");
      setOpen(false);
    },
    [draft, getRoom],
  );

  if (!open) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end p-3">
      <ul className="mb-2 max-w-md space-y-0.5 font-mono text-xs text-gray-100">
        {lines.map((l, i) => (
          <li key={`${l.name}-${i}`} className="rounded bg-black/60 px-2 py-0.5">
            <span className="font-bold text-emerald-300">{l.name}:</span> {l.text}
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="pointer-events-auto max-w-md">
        <input
          ref={inputRef}
          value={draft}
          maxLength={CHAT_MAX_LEN}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Talk some smack here..."
          className="w-full rounded border border-gray-700 bg-black/70 px-2 py-1 font-mono text-sm text-gray-100 outline-none"
        />
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `client/src/game/GameMount.tsx`**

Add `import { ChatOverlay } from "./ChatOverlay.js";`, then replace the returned JSX with (the Phaser parent keeps its exact size; the overlay floats above the canvas):

```tsx
  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="relative h-[600px] w-[800px]">
        <div ref={containerRef} className="h-full w-full" />
        <ChatOverlay />
      </div>
    </div>
  );
```

- [ ] **Step 3: Gate game input in `ArenaScene.sampleInput()`**

Add a field:

```ts
  private prevChatOpen = false;
```

Replace the top of `sampleInput()` (everything before the `const me = ...` line) with:

```ts
  private sampleInput(): void {
    if (!this.prediction) return;
    const chatOpen = Boolean((window as unknown as { __chatOpen?: boolean }).__chatOpen);
    if (chatOpen !== this.prevChatOpen) {
      const kb = this.input.keyboard;
      if (kb) {
        // Phaser's key captures preventDefault W/A/S/D/SPACE/R keydowns, which
        // would swallow typing; release them while the box is open.
        if (chatOpen) kb.disableGlobalCapture();
        else {
          kb.enableGlobalCapture();
          kb.resetKeys(); // drop JustDown latches typed into the chat box
        }
      }
      this.prevChatOpen = chatOpen;
    }
    const input: SimInput = chatOpen
      ? { up: false, down: false, left: false, right: false, roll: false }
      : {
          up: this.keys.W.isDown,
          down: this.keys.S.isDown,
          left: this.keys.A.isDown,
          right: this.keys.D.isDown,
          roll: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
        };
    if (!chatOpen) {
      const pointer = this.input.activePointer;
      pointer.updateWorldPoint(this.cameras.main);
      this.localAimAngle = Math.atan2(pointer.worldY - this.prediction.y, pointer.worldX - this.prediction.x);
    }
    const msg = this.prediction.sample(input, this.localAimAngle);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);
    if (chatOpen) return; // typing: no reload/active-reload, no firing
```

(The remainder of the method — the `me` lookup, R handling, full-auto fire — stays verbatim below the early return.)

- [ ] **Step 4: Gates + manual check**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. In `pnpm dev` with two browsers: TAB opens the box and the player stops dead (even with W held); typing `wasd r ` produces text, not movement/reload; Enter sends, the box closes, the other browser opens chat with TAB and sees the line; ESC closes without sending; movement resumes after close with no phantom roll.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): TAB chat overlay with full game-input suppression while open"
```

---

### Task 11: E2E — world spec + combat-spec hardening

**Files:**
- Modify: `tests/combat.spec.ts`
- Create: `tests/world.spec.ts`

The world spec is one fat scenario (the lobby room is shared; specs are few and fat by convention): natural spawner proves itself (count > 0) → spawner off → dev-spawned zombies at verified coordinates drive chase/attack/kill deterministically → pickup feed → chat round-trip. The combat spec turns the spawner OFF at setup (the `__arena.setZombieSpawning` hook from Task 8) so zombie chip damage can't flake its hp assertions. Movement/smoke need nothing — they assert displacement/visibility only.

- [ ] **Step 1: Harden `tests/combat.spec.ts`**

Add the helper next to `teleportTo`:

```ts
async function setZombieSpawning(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as { __arena?: { setZombieSpawning(e: boolean): void } }).__arena?.setZombieSpawning(on);
  }, enabled);
}
```

and in the test body, right after the two `hookReady` awaits:

```ts
    await setZombieSpawning(pageA, false); // 4B: clears strays + stops the spawner
```

- [ ] **Step 2: Create `tests/world.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

type DebugZombie = { id: string; x: number; y: number };
type DebugPlayer = { id: string; x: number; y: number; hp: number; local: boolean };

async function hookReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __arena?: unknown }).__arena)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function zombies(page: Page): Promise<DebugZombie[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { zombies(): DebugZombie[] } }).__arena;
    return hook ? hook.zombies() : [];
  });
}

async function players(page: Page): Promise<DebugPlayer[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): DebugPlayer[] } }).__arena;
    return hook ? hook.players() : [];
  });
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

async function setZombieSpawning(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as { __arena?: { setZombieSpawning(e: boolean): void } }).__arena?.setZombieSpawning(on);
  }, enabled);
}

async function spawnZombie(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([zx, zy]) => {
      (window as unknown as { __arena?: { spawnZombie(a: number, b: number): void } }).__arena?.spawnZombie(zx, zy);
    },
    [x, y] as const,
  );
}

async function feedHas(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((n) => {
    const hook = (window as unknown as { __arena?: { feed(): string[] } }).__arena;
    return hook?.feed().some((line) => line.includes(n)) ?? false;
  }, needle);
}

async function nearestZombieTo(page: Page, x: number, y: number): Promise<{ z: DebugZombie; d: number } | null> {
  const zs = await zombies(page);
  let best: { z: DebugZombie; d: number } | null = null;
  for (const z of zs) {
    const d = Math.hypot(z.x - x, z.y - y);
    if (!best || d < best.d) best = { z, d };
  }
  return best;
}

test("world layer: zombies spawn, chase, attack, die to bullets; pickups feed; chat relays", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);
  try {
    await hookReady(pageA);
    await hookReady(pageB);
    // Alice anchors the verified-clear corridor (player grid, y=128,
    // x 128..200); bob parks in the far corner — OFF alice's firing line, or
    // his AABB would eat the bullets meant for the zombies in step 4, and far
    // enough that dev-spawned zombies always pick alice as nearest.
    await teleportTo(pageA, 128, 128);
    await teleportTo(pageB, 992, 992);
    await pageA.waitForTimeout(500);

    // 1. The natural spawner works: a zombie appears (first spawn at 4 s).
    await expect.poll(async () => (await zombies(pageA)).length, { timeout: 12_000 }).toBeGreaterThan(0);

    // 2. Determinism from here on (addendum 3): stop the spawner — which also
    // clears live zombies — then plant one on the verified corridor (player
    // grid, y=128, x 128..200) 60 px from alice.
    await setZombieSpawning(pageA, false);
    await expect.poll(async () => (await zombies(pageA)).length, { timeout: 5_000 }).toBe(0);
    await spawnZombie(pageA, 188, 128);

    // 3. Chase + attack: it closes the 60 px (stops at the 28 px attack
    // range), then bites alice — 5 hp per swing, 1/s.
    await expect
      .poll(async () => (await nearestZombieTo(pageA, 128, 128))?.d ?? Infinity, { timeout: 10_000 })
      .toBeLessThan(35);
    await expect
      .poll(async () => (await players(pageA)).find((p) => p.local)?.hp ?? 100, { timeout: 10_000 })
      .toBeLessThan(100);

    // 4. Kill: plant a second zombie down the row — the player-grid wall pins
    // it at x≈264 (it can never reach alice) while the row stays clear on the
    // bullet grid. Fire at the nearest zombie's live position until the world
    // is zombie-free: the first bullet takes the point-blank attacker, the
    // next ones take the pinned zombie. One-hit-kill either way.
    await spawnZombie(pageA, 300, 128);
    await expect
      .poll(
        async () => {
          const zs = await zombies(pageA);
          if (zs.length === 0) return true;
          const me = (await players(pageA)).find((p) => p.local);
          if (!me) return false;
          let nearest = zs[0];
          let best = Infinity;
          for (const z of zs) {
            const d = Math.hypot(z.x - me.x, z.y - me.y);
            if (d < best) {
              best = d;
              nearest = z;
            }
          }
          if (nearest) await fireAt(pageA, nearest.x, nearest.y);
          return false;
        },
        { timeout: 20_000, intervals: [400] },
      )
      .toBe(true);

    // 5. Pickup: step onto the speed slot (544,573); both clients see the feed line.
    await teleportTo(pageA, 544, 573);
    await expect.poll(() => feedHas(pageA, "has picked up a speed boost"), { timeout: 5_000 }).toBe(true);
    await expect.poll(() => feedHas(pageB, "has picked up a speed boost"), { timeout: 5_000 }).toBe(true);

    // 6. Chat: alice TABs, types, Enter; the box closes; bob TABs and reads it.
    await pageA.keyboard.press("Tab");
    const input = pageA.getByPlaceholder("Talk some smack here...");
    await expect(input).toBeVisible();
    await input.fill("gg ez");
    await pageA.keyboard.press("Enter");
    await expect(input).toBeHidden();
    await pageB.keyboard.press("Tab");
    await expect(pageB.getByText("gg ez")).toBeVisible({ timeout: 5_000 });

    // Audio autoplay notices are environmental, not bugs (zombie sounds trip
    // them just like gunfire).
    const realErrors = errors.filter((e) => !/AudioContext|autoplay/i.test(e));
    expect(realErrors).toEqual([]);
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: Run the suite**

Run: `CI=1 pnpm test:e2e`
Expected: 4/4 (smoke, movement, combat, world). The world spec runs last alphabetically and leaves via consented `close()`, so the room disposes cleanly.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test(e2e): world spec (zombies/pickups/chat); combat spec disables the spawner"
```

---

### Task 12: Vision cone (client-only; CUTTABLE)

**Files:**
- Create: `client/src/game/cone.ts`
- Modify: `client/src/game/scenes/ArenaScene.ts`

Spec risk 3: this is the most uncertain port. If Phaser's GeometryMask (especially the inverted instance, or one mask shared across many sprites) misbehaves or tanks the frame rate, **cut it**: `git revert` this task's commit and record the cut in PROGRESS.md — the spec explicitly allows it.

Render model (legacy `Lighting.js` translated to Phaser 3 depths/masks):

| Layer | Depth | Mask |
| --- | --- | --- |
| map tiles | 0 (default) | none — visible, darkened outside cone |
| remote players/guns/labels, zombies, corpses | 5–7 | **cone mask** — invisible outside the cone |
| darkness rect (0.7 alpha, world-size) | 40 | **inverted cone mask** — transparent inside the cone |
| pickups | 43 | none — full-bright (legacy render order) |
| bullets | 44 | none — full-bright (legacy bullet groups sat above blackness) |
| local player / own gun / own label | 45/46/47 | none — you always see yourself |
| muzzle flash | 48 | none |
| HUD | 900+ | none (scrollFactor 0) |

Sight grid = `wallCollision` + `litWallCollision` (addendum 7): walls of both kinds block vision, water doesn't.

- [ ] **Step 1: Create `client/src/game/cone.ts`**

```ts
import Phaser from "phaser";
import {
  CONE_ANGLE_RAD,
  CONE_LENGTH_PX,
  CONE_RAYS,
  CONE_DARKNESS_ALPHA,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TILE_SIZE,
  isSolidTile,
  type SolidityGrid,
} from "@genzed/shared";

const RAY_STEP_PX = 4;

// Client-only port of the 2017 Lighting plugin: a 90°/270 px cone toward the
// pointer. ONE Graphics redrawn per frame feeds two GeometryMasks — normal on
// remote entities (hidden outside the cone), inverted on a darkness rect (the
// cone stays bright). Purely cosmetic: a modified client could see everything —
// accepted at prototype tier (spec "out of scope").
export class VisionCone {
  private graphics: Phaser.GameObjects.Graphics;
  readonly mask: Phaser.Display.Masks.GeometryMask;
  private darkness: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, private grid: SolidityGrid) {
    this.graphics = scene.add.graphics().setVisible(false); // mask source only
    this.mask = this.graphics.createGeometryMask();
    this.darkness = scene.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, CONE_DARKNESS_ALPHA)
      .setOrigin(0)
      .setDepth(40);
    const inverted = this.graphics.createGeometryMask();
    inverted.invertAlpha = true;
    this.darkness.setMask(inverted);
  }

  // Redraw the cone polygon from the local player toward aimAngle, raycasting
  // the sight grid (60 rays × 4 px steps — trivial per frame).
  update(px: number, py: number, aimAngle: number): void {
    const g = this.graphics;
    g.clear();
    g.fillStyle(0xffffff, 1);
    const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(px, py)];
    for (let i = 0; i <= CONE_RAYS; i += 1) {
      const angle = aimAngle - CONE_ANGLE_RAD / 2 + (CONE_ANGLE_RAD * i) / CONE_RAYS;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let lastX = px;
      let lastY = py;
      for (let d = RAY_STEP_PX; d <= CONE_LENGTH_PX; d += RAY_STEP_PX) {
        const x = px + cos * d;
        const y = py + sin * d;
        if (isSolidTile(this.grid, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) break;
        lastX = x;
        lastY = y;
      }
      points.push(new Phaser.Math.Vector2(lastX, lastY));
    }
    g.fillPoints(points, true);
  }

  destroy(): void {
    this.darkness.destroy();
    this.graphics.destroy();
  }
}
```

- [ ] **Step 2: Integrate in `ArenaScene.ts`**

(a) Import `VisionCone` from `../cone.js`. Add field:

```ts
  private cone: VisionCone | null = null;
```

(b) In `create()`, right after `this.grid = buildSolidityGrid(mapJson);`:

```ts
    // Sight grid: walls (lit or not) block vision; water doesn't (addendum 7).
    this.cone = new VisionCone(this, buildSolidityGrid(mapJson, ["wallCollision", "litWallCollision"]));
```

(c) Depths + masks:

- `addPlayer`, local branch: after creating the three objects — `sprite.setDepth(45); gun.setDepth(46); label.setDepth(47);`
- `addPlayer`, remote branch: `if (this.cone) { sprite.setMask(this.cone.mask); gun.setMask(this.cone.mask); label.setMask(this.cone.mask); }`
- `addZombie`: `if (this.cone) sprite.setMask(this.cone.mask);`
- `removeZombie`: same for the `corpse` sprite.
- `addBullet`: `.setDepth(4)` → `.setDepth(44)`.
- `onShot`: the flash `.setDepth(8)` → `.setDepth(48)`.

(d) In `update()`, after the crosshair block:

```ts
    if (local && this.cone) this.cone.update(local.sprite.x, local.sprite.y, this.localAimAngle);
```

(e) In `shutdown()`:

```ts
    this.cone?.destroy();
    this.cone = null;
```

- [ ] **Step 3: Gates + E2E regression**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && CI=1 pnpm test:e2e`
Expected: all green — the E2E hooks read schema + sprite positions, which masks don't affect. If the world/combat specs newly fail here, the cone broke something real: investigate or cut.

- [ ] **Step 4: Manual verify + evidence**

`pnpm dev`, two browsers: the world outside the 90° cone is darkened; the remote player and zombies are INVISIBLE outside the cone and pop in inside it; walls clip the cone; pickups/bullets/own player stay visible everywhere; HUD unaffected; smooth frame rate while spinning the mouse. Screenshot a moment with one enemy inside and one outside the cone → `docs/stage4-evidence/4b-cone.png`.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): vision cone — raycast geometry mask over remote entities + inverted darkness"
```

---

### Task 13: Docs, full verification, evidence

**Files:**
- Modify: `playwright.config.ts` (env-overridable baseURL for the prod-bundle run)
- Modify: `docs/PROGRESS.md`
- Create: `docs/stage4-evidence/4b-*.png`

- [ ] **Step 1: Make the E2E base URL overridable** — `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PW_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // Tests joinOrCreate the same in-process lobby room; parallel workers
  // would land in one room and corrupt each other's player counts.
  workers: 1,
  use: {
    baseURL,
    headless: true,
  },
  // With PW_BASE_URL set (prod-bundle verification) the caller owns the server.
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
```

- [ ] **Step 2: Full gates, CI-faithful**

```bash
pnpm build && pnpm typecheck && pnpm lint
mise x node@20.18.0 -- pnpm -C server test   # CI runs Node 20, not the shell's 24
CI=1 pnpm test:e2e
```

Expected: everything green (vitest now ~95+ tests / 14 files; E2E 4/4).

- [ ] **Step 3: Prod-bundle E2E + evidence**

```bash
pnpm build
PORT=8080 node server/dist/index.js &   # NODE_ENV unset → dev seams active, same as 4A's prod check
PW_BASE_URL=http://localhost:8080 pnpm test:e2e
kill %1
```

Expected: 4/4 against the prod bundle. Then in `pnpm dev` with two browsers, capture:

- `docs/stage4-evidence/4b-zombies.png` — zombies converging, one corpse visible, kill feed showing a pickup line
- `docs/stage4-evidence/4b-chat.png` — chat box open with a relayed line on the receiving client
- `docs/stage4-evidence/4b-cone.png` — from Task 12 (skip if the cone was cut)

- [ ] **Step 4: Update `docs/PROGRESS.md`**

- Stage table: `4B. Combat — Zombies + pickups` → `✅ Built and verified on stage-4b-world — not yet merged` (mirror the 4A wording pre-merge).
- Add a "Stage 4B — what shipped" section in the established voice: zombie spawner/AI numbers (flag invented ones), pickup rules, chat gates, cone implementation (or its cut), the three nudged zombie spawn points, plan addenda 1–7, and a verification table mirroring 4A's (typecheck/lint/test/e2e dev/e2e prod/manual screenshots; Docker row stays ⚠️ PENDING while the daemon is down — byte-identical Dockerfile note still applies).
- Stage 5 notes to carry forward: chat has no unread indicator (messages invisible until TAB); zombie groan volume curve is legacy-quirky (`-0.2` offset); spawner numbers need playtest tuning; `themeLoop.wav` 6.1 MB conversion still outstanding.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts docs
git commit -m "docs: PROGRESS 4B entry + evidence; e2e base URL overridable for prod runs"
```

Then hand off to `superpowers:finishing-a-development-branch` (PR `stage-4b-world` → `master`, judge CI by the **build job** until `FLY_API_TOKEN` exists). After merge, flip CLAUDE.md's staged-delivery line 4 to ✅.

---

## Spec coverage check (4B slice contents → tasks)

| Spec item | Where |
| --- | --- |
| Zombie schema + spawner + AI + death/corpse + sounds | Tasks 3, 4, 5, 8 |
| Pickups: server state, collection, effects, respawn + feed lines | Tasks 2, 3, 6, 9 |
| Chat: TAB overlay, relay, input gating (velocity zeroes) | Tasks 2, 7, 10 |
| Vision cone: client-only, cuttable | Task 12 |
| Spec testing bullets: zombie target selection + attack cadence; pickup effects + respawn slots; zombie E2E | Tasks 4, 5, 6, 11 |
| Done criteria: zombies pressure + die, pickups work, chat works, cone renders or consciously cut | Tasks 11, 12, 13 |

Deviations and additions are listed in "Plan addenda" at the top; invented spawner numbers stay isolated in `shared/src/tuning.ts` for playtest tuning, per spec.




