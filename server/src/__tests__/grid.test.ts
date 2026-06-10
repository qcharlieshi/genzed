import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSolidityGrid,
  isSolidTile,
  MAP_TILES,
  SPAWN_POINTS,
  TILE_SIZE,
  type TiledMapJson,
} from "@genzed/shared";

const mapJson = JSON.parse(
  readFileSync(new URL("../../../client/public/assets/maps/main.json", import.meta.url), "utf8"),
) as TiledMapJson;

describe("buildSolidityGrid (real arena map)", () => {
  const grid = buildSolidityGrid(mapJson);

  it("is 35×35", () => {
    expect(grid.width).toBe(MAP_TILES);
    expect(grid.height).toBe(MAP_TILES);
  });

  it("unions the three collision layers to exactly 411 solid tiles", () => {
    let count = 0;
    for (const v of grid.solid) count += v;
    expect(count).toBe(411);
  });

  it("marks the wall ring solid and open floor walkable", () => {
    expect(isSolidTile(grid, 0, 0)).toBe(true); // corner wall
    expect(isSolidTile(grid, 1, 2)).toBe(false); // known open floor
  });

  it("treats out-of-bounds as solid", () => {
    expect(isSolidTile(grid, -1, 0)).toBe(true);
    expect(isSolidTile(grid, 35, 0)).toBe(true);
  });

  it("keeps all 8 legacy spawn tiles walkable", () => {
    for (const p of SPAWN_POINTS) {
      expect(isSolidTile(grid, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE))).toBe(false);
    }
  });
});
