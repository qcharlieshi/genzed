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
