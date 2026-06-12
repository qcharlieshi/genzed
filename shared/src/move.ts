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
