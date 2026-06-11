import { describe, it, expect } from "vitest";
import { MAP_TILES } from "@genzed/shared";
import { loadSolidityGrid } from "../sim/collision.js";

describe("loadSolidityGrid", () => {
  it("loads the arena map from disk and builds a 35×35 grid", () => {
    const grid = loadSolidityGrid();
    expect(grid.width).toBe(MAP_TILES);
    expect(grid.height).toBe(MAP_TILES);
  });

  it("caches the grid (same reference on repeat calls)", () => {
    expect(loadSolidityGrid()).toBe(loadSolidityGrid());
  });
});
