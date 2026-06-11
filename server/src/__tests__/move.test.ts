import { describe, it, expect } from "vitest";
import {
  velocityFromInput,
  move,
  stepPlayer,
  PLAYER_SPEED,
  DIAGONAL_FACTOR,
  PLAYER_W,
  WORLD_WIDTH,
  DIR_DOWN,
  DIR_UP,
  DIR_LEFT,
  ROLL_SPEED_BONUS,
  ROLL_DURATION_TICKS,
  ROLL_COOLDOWN_TICKS,
  inputMask,
  type SolidityGrid,
  type PlayerSim,
  type SimInput,
} from "@genzed/shared";

function makeGrid(width: number, height: number, solidCells: Array<[number, number]> = []): SolidityGrid {
  const solid = new Uint8Array(width * height);
  for (const [tx, ty] of solidCells) solid[ty * width + tx] = 1;
  return { width, height, solid };
}

const NO_KEYS = { up: false, down: false, left: false, right: false };

function sim(x: number, y: number, extra: Partial<PlayerSim> = {}): PlayerSim {
  return {
    x, y, dir: DIR_DOWN,
    rollTicksLeft: 0, rollDirMask: 0, rollCooldownTicks: 0, speedBonus: 0,
    ...extra,
  };
}

const IDLE_SIM: SimInput = { up: false, down: false, left: false, right: false, roll: false };

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

describe("stepPlayer (one 50 ms tick, sim-state)", () => {
  it("advances 5 px per tick at PLAYER_SPEED and reports velocity", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, sim(80, 80), { ...IDLE_SIM, right: true });
    expect(r.sim.x).toBeCloseTo(85, 6);
    expect(r.sim.y).toBe(80);
    expect(r.vx).toBe(PLAYER_SPEED);
    expect(r.vy).toBe(0);
  });

  it("applies speedBonus to walking", () => {
    const g = makeGrid(10, 10);
    const r = stepPlayer(g, sim(80, 80, { speedBonus: 36 }), { ...IDLE_SIM, right: true });
    expect(r.sim.x).toBeCloseTo(80 + 136 * 0.05, 4);
  });

  it("updates facing from velocity and keeps it when idle", () => {
    const g = makeGrid(10, 10);
    const moved = stepPlayer(g, sim(80, 80), { ...IDLE_SIM, up: true });
    expect(moved.sim.dir).toBe(DIR_UP);
    const idle = stepPlayer(g, moved.sim, IDLE_SIM);
    expect(idle.sim.dir).toBe(DIR_UP);
  });

  it("does not mutate the input sim", () => {
    const g = makeGrid(10, 10);
    const before = sim(80, 80, { rollCooldownTicks: 5, rollDirMask: 8 });
    stepPlayer(g, before, { ...IDLE_SIM, right: true });
    expect(before).toEqual(sim(80, 80, { rollCooldownTicks: 5, rollDirMask: 8 }));
  });
});

describe("roll FSM", () => {
  it("starts a roll: 12 ticks at base+ROLL_SPEED_BONUS in the held direction", () => {
    const g = makeGrid(20, 20);
    const r = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true });
    expect(r.sim.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 1); // start tick consumed one
    expect(r.sim.rollDirMask).toBe(inputMask({ up: false, down: false, left: false, right: true }));
    expect(r.sim.rollCooldownTicks).toBe(ROLL_COOLDOWN_TICKS);
    expect(r.sim.x).toBeCloseTo(160 + (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4); // 10 px
  });

  it("normalizes diagonal rolls AFTER adding the bonus (spec deviation 5)", () => {
    const g = makeGrid(20, 20);
    const r = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true, down: true });
    const perAxis = (PLAYER_SPEED + ROLL_SPEED_BONUS) * DIAGONAL_FACTOR * 0.05;
    expect(r.sim.x).toBeCloseTo(160 + perAxis, 4);
    expect(r.sim.y).toBeCloseTo(160 + perAxis, 4);
  });

  it("ignores movement keys mid-roll (velocity locked to the roll vector)", () => {
    const g = makeGrid(20, 20);
    let s = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true }).sim;
    const xAfterStart = s.x;
    s = stepPlayer(g, s, { ...IDLE_SIM, left: true }).sim; // opposing key — ignored
    expect(s.x).toBeCloseTo(xAfterStart + (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
    expect(s.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 2);
  });

  it("rolls toward facing when no movement keys (or cancelled keys) are held", () => {
    const g = makeGrid(20, 20);
    const fromFacing = stepPlayer(g, sim(160, 160, { dir: DIR_UP }), { ...IDLE_SIM, roll: true });
    expect(fromFacing.sim.y).toBeCloseTo(160 - (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
    const cancelled = stepPlayer(g, sim(160, 160, { dir: DIR_LEFT }), { ...IDLE_SIM, roll: true, up: true, down: true });
    expect(cancelled.sim.x).toBeCloseTo(160 - (PLAYER_SPEED + ROLL_SPEED_BONUS) * 0.05, 4);
  });

  it("enforces the cooldown from roll START (re-roll possible exactly 20 ticks later)", () => {
    const g = makeGrid(20, 20);
    let s = stepPlayer(g, sim(160, 160), { ...IDLE_SIM, roll: true, right: true }).sim; // tick 0
    for (let t = 1; t < ROLL_COOLDOWN_TICKS; t += 1) {
      s = stepPlayer(g, s, { ...IDLE_SIM, roll: true }).sim; // spamming roll — all ignored
      expect(s.rollDirMask).toBe(8); // still the original roll's mask
    }
    expect(s.rollTicksLeft).toBe(0); // roll itself ended after 12 ticks
    // 19 decrements have run (ticks 1..19) → cd = 1. The 20th call decrements
    // it to 0 and THEN checks the gate, so the re-roll lands exactly at tick 20.
    expect(s.rollCooldownTicks).toBe(1);
    s = stepPlayer(g, s, { ...IDLE_SIM, roll: true, up: true }).sim; // tick 20 — allowed
    expect(s.rollTicksLeft).toBe(ROLL_DURATION_TICKS - 1);
    expect(s.rollDirMask).toBe(1);
  });

  it("a roll into a wall stops flush and keeps ticking", () => {
    // Solid tile (3,2) spans x [96,128); start at (80,80): right edge stops at 88.
    const g = makeGrid(10, 10, [[3, 2]]);
    let s = sim(80, 80);
    for (let t = 0; t < ROLL_DURATION_TICKS; t += 1) {
      s = stepPlayer(g, s, t === 0 ? { ...IDLE_SIM, roll: true, right: true } : IDLE_SIM).sim;
    }
    expect(s.x).toBeCloseTo(88, 1);
    expect(s.rollTicksLeft).toBe(0);
  });
});
