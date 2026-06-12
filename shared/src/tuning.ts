// Gameplay constants ported from legacy (see Stage 3 spec "Verified legacy facts").

export const TILE_SIZE = 32;
export const MAP_TILES = 35;
export const WORLD_WIDTH = MAP_TILES * TILE_SIZE; // 1120
export const WORLD_HEIGHT = MAP_TILES * TILE_SIZE;

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

// Legacy player.js spawn table — with one deviation: legacy (896,704) overlaps a
// wall under our centered-AABB convention (legacy relied on Phaser 2 arcade
// de-penetration), so it is nudged into the open column at (912,704).
// All 8 verified non-overlapping with ≥22 px of clear travel upward.
export const SPAWN_POINTS = [
  { x: 128, y: 128 },
  { x: 992, y: 128 },
  { x: 384, y: 416 },
  { x: 736, y: 416 },
  { x: 224, y: 704 },
  { x: 912, y: 704 },
  { x: 96, y: 992 },
  { x: 992, y: 992 },
] as const;

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
export const CONE_RAYS = 60; // DEVIATION — legacy cast 300 px-step rays (Lighting.js:13); a Phaser 3 polygon needs far fewer angular samples
export const CONE_DARKNESS_ALPHA = 0.7;
