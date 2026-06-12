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
// px/tick) — no crossing deeper than one substep (≤16 px) can be skipped —
// shallow corner grazes may pass, which reads as a near-miss. Bullets collide
// with the BULLET grid (wallCollision only) and with player AABBs; the shooter
// and immune players are transparent.
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
