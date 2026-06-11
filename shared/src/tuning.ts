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
