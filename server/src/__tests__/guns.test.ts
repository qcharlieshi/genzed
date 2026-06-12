import { describe, it, expect } from "vitest";
import { GUNS, gunForLevel, WIN_GUN_LEVEL } from "@genzed/shared";

// Spec "Gun ladder" table — cumulative values resolved from legacy upgrade deltas.
const EXPECTED = [
  { name: "pistol", damage: 10, fireIntervalMs: 350, clip: 10, bulletSpeed: 500, bulletLifetimeMs: 0 },
  { name: "smg", damage: 5, fireIntervalMs: 150, clip: 30, bulletSpeed: 500, bulletLifetimeMs: 0 },
  { name: "sniper", damage: 70, fireIntervalMs: 1050, clip: 5, bulletSpeed: 1000, bulletLifetimeMs: 0 },
  { name: "heavy", damage: 90, fireIntervalMs: 1550, clip: 2, bulletSpeed: 200, bulletLifetimeMs: 0 },
  { name: "melee", damage: 70, fireIntervalMs: 350, clip: -1, bulletSpeed: 200, bulletLifetimeMs: 50 },
];

describe("gun ladder", () => {
  it("has 5 weapons; level 6 is the win state", () => {
    expect(GUNS).toHaveLength(5);
    expect(WIN_GUN_LEVEL).toBe(6);
  });

  it("matches the spec table cell-for-cell", () => {
    EXPECTED.forEach((e, i) => {
      const g = GUNS[i];
      if (!g) throw new Error(`missing gun ${i}`);
      expect(g).toMatchObject(e);
    });
  });

  it("gunForLevel indexes by level and clamps the win level to the last weapon", () => {
    expect(gunForLevel(1).name).toBe("pistol");
    expect(gunForLevel(5).name).toBe("melee");
    expect(gunForLevel(6).name).toBe("melee"); // hasWon — phase ends, but never throws
  });

  it("uses real atlas frame names", () => {
    expect(gunForLevel(1).gunFrame).toBe("pistol.png");
    expect(gunForLevel(1).bulletFrame).toBe("pistolBullet.png");
    expect(gunForLevel(2).gunFrame).toBe("ak5 (1).png");
    expect(gunForLevel(2).bulletFrame).toBe("New Piskel (11).png");
  });
});
