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
