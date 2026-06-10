import { describe, it, expect } from "vitest";
import {
  velocityFromInput,
  move,
  stepPlayer,
  PLAYER_SPEED,
  DIAGONAL_FACTOR,
  PLAYER_W,
  WORLD_WIDTH,
  type SolidityGrid,
} from "@genzed/shared";

function makeGrid(width: number, height: number, solidCells: Array<[number, number]> = []): SolidityGrid {
  const solid = new Uint8Array(width * height);
  for (const [tx, ty] of solidCells) solid[ty * width + tx] = 1;
  return { width, height, solid };
}

const NO_KEYS = { up: false, down: false, left: false, right: false };

describe("velocityFromInput", () => {
  it("is zero with no keys", () => {
    expect(velocityFromInput(NO_KEYS)).toEqual({ vx: 0, vy: 0 });
  });

  it("moves at PLAYER_SPEED on one axis", () => {
    expect(velocityFromInput({ ...NO_KEYS, right: true })).toEqual({ vx: PLAYER_SPEED, vy: 0 });
    expect(velocityFromInput({ ...NO_KEYS, up: true })).toEqual({ vx: 0, vy: -PLAYER_SPEED });
  });

  it("applies the diagonal factor on two axes", () => {
    const v = velocityFromInput({ ...NO_KEYS, right: true, down: true });
    expect(v.vx).toBeCloseTo(PLAYER_SPEED * DIAGONAL_FACTOR, 6);
    expect(v.vy).toBeCloseTo(PLAYER_SPEED * DIAGONAL_FACTOR, 6);
  });

  it("cancels opposing keys", () => {
    expect(velocityFromInput({ up: true, down: true, left: true, right: true })).toEqual({ vx: 0, vy: 0 });
  });
});

describe("move (axis-separated AABB sweep)", () => {
  it("moves freely in open space", () => {
    const g = makeGrid(10, 10);
    expect(move(g, 80, 80, 5, 0)).toEqual({ x: 85, y: 80 });
  });

  it("stops flush against a wall on the right", () => {
    // Solid tile (3,2) spans x [96,128). Right edge must stop at 96 → x = 96 - 8 = 88.
    const g = makeGrid(10, 10, [[3, 2]]);
    const r = move(g, 80, 80, 20, 0);
    expect(r.x).toBeCloseTo(88, 1);
    expect(r.y).toBe(80);
    // Pushing again doesn't penetrate.
    const r2 = move(g, r.x, r.y, 20, 0);
    expect(r2.x).toBeCloseTo(88, 1);
  });

  it("stops flush against a wall on the left", () => {
    // Solid tile (1,2) spans x [32,64). Left edge stops at 64 → x = 64 + 8 = 72.
    const g = makeGrid(10, 10, [[1, 2]]);
    const r = move(g, 80, 80, -20, 0);
    expect(r.x).toBeCloseTo(72, 1);
  });

  it("slides along a wall when moving diagonally into it", () => {
    const g = makeGrid(10, 10, [[3, 2]]);
    const r = move(g, 80, 80, 20, 10);
    expect(r.x).toBeCloseTo(88, 1); // clamped by the wall
    expect(r.y).toBeCloseTo(90, 6); // vertical motion unaffected
  });

  it("stops flush against floors and ceilings", () => {
    // Solid tile (2,3) spans y [96,128). Bottom edge stops at 96 → y = 96 - 10 = 86.
    const g = makeGrid(10, 10, [[2, 3]]);
    const down = move(g, 80, 80, 0, 20);
    expect(down.y).toBeCloseTo(86, 1);
    // Solid tile (2,1) spans y [32,64). Top edge stops at 64 → y = 64 + 10 = 74.
    const g2 = makeGrid(10, 10, [[2, 1]]);
    const up = move(g2, 80, 80, 0, -20);
    expect(up.y).toBeCloseTo(74, 1);
  });

  it("indexes non-square grids correctly", () => {
    // 12 wide × 6 tall; solid tile (9,2) spans x [288,320). Right edge stops at 288 → x = 280.
    const g = makeGrid(12, 6, [[9, 2]]);
    const r = move(g, 264, 80, 20, 0);
    expect(r.x).toBeCloseTo(280, 1);
    expect(r.y).toBe(80);
  });

  it("never leaves the world bounds", () => {
    // Full-size empty grid: the only stop at the rim is the out-of-bounds/world clamp.
    const g = makeGrid(35, 35);
    const r = move(g, 1100, 560, 25, 0);
    expect(r.x).toBeCloseTo(WORLD_WIDTH - PLAYER_W / 2, 1);
  });
});

describe("stepPlayer (one 50 ms tick)", () => {
  it("advances 5 px per tick at PLAYER_SPEED", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, 80, 80, { ...NO_KEYS, right: true });
    expect(r.x).toBeCloseTo(85, 6);
    expect(r.y).toBe(80);
    expect(r.vx).toBe(PLAYER_SPEED);
    expect(r.vy).toBe(0);
  });

  it("advances ~3.536 px per axis per tick on diagonals", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, 80, 80, { ...NO_KEYS, right: true, down: true });
    expect(r.x).toBeCloseTo(80 + PLAYER_SPEED * DIAGONAL_FACTOR * 0.05, 4);
    expect(r.y).toBeCloseTo(80 + PLAYER_SPEED * DIAGONAL_FACTOR * 0.05, 4);
  });
});
