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
