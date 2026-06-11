import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSolidityGrid,
  isSolidTile,
  MAP_TILES,
  PLAYER_H,
  PLAYER_W,
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

  it("keeps all 8 spawn AABB footprints walkable", () => {
    for (const p of SPAWN_POINTS) {
      const tx0 = Math.floor((p.x - PLAYER_W / 2) / TILE_SIZE);
      const tx1 = Math.floor((p.x + PLAYER_W / 2 - 0.001) / TILE_SIZE);
      const ty0 = Math.floor((p.y - PLAYER_H / 2) / TILE_SIZE);
      const ty1 = Math.floor((p.y + PLAYER_H / 2 - 0.001) / TILE_SIZE);
      for (let tx = tx0; tx <= tx1; tx += 1) {
        for (let ty = ty0; ty <= ty1; ty += 1) {
          expect(isSolidTile(grid, tx, ty), `spawn (${p.x},${p.y}) tile (${tx},${ty})`).toBe(false);
        }
      }
    }
  });

  it("builds the bullet grid from wallCollision only (285 tiles)", () => {
    const bulletGrid = buildSolidityGrid(mapJson, ["wallCollision"]);
    let count = 0;
    for (const v of bulletGrid.solid) count += v;
    expect(count).toBe(285); // vs 411 in the player grid — bullets fly over litWall/water
  });
});
