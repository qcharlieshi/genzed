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
