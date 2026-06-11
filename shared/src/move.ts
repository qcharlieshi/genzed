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
