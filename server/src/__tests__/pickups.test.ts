import { describe, it, expect } from "vitest";
import { PLAYER_W, PLAYER_H } from "@genzed/shared";
import { applyHealthPickup, overlapsPickup, pickRespawnSlot } from "../sim/pickups.js";

describe("applyHealthPickup (legacy managePickups.js:84-87)", () => {
  it("adds 30 below the 70 threshold", () => {
    expect(applyHealthPickup(0)).toBe(30);
    expect(applyHealthPickup(50)).toBe(80);
    expect(applyHealthPickup(69)).toBe(99);
  });
  it("sets to 100 at/above the threshold", () => {
    expect(applyHealthPickup(70)).toBe(100);
    expect(applyHealthPickup(95)).toBe(100);
    expect(applyHealthPickup(100)).toBe(100);
  });
});

describe("overlapsPickup (player AABB vs 32×32 pickup box)", () => {
  const HW = PLAYER_W / 2;
  const HH = PLAYER_H / 2;
  it("overlaps inside the combined half-extents and not outside", () => {
    expect(overlapsPickup(100, 100, 100, 100)).toBe(true);
    expect(overlapsPickup(100 + HW + 16 - 1, 100, 100, 100)).toBe(true);
    expect(overlapsPickup(100 + HW + 16 + 1, 100, 100, 100)).toBe(false);
    expect(overlapsPickup(100, 100 + HH + 16 - 1, 100, 100)).toBe(true);
    expect(overlapsPickup(100, 100 + HH + 16 + 1, 100, 100)).toBe(false);
  });
});

describe("pickRespawnSlot", () => {
  it("returns an unoccupied slot index", () => {
    const occupied = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let i = 0; i < 20; i += 1) {
      expect(pickRespawnSlot(occupied)).toBe(10); // only free slot
    }
  });
  it("returns -1 when everything is occupied (defensive; unreachable with ≤4 pickups)", () => {
    expect(pickRespawnSlot(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(-1);
  });
});
