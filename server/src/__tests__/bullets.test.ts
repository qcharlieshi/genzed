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
