import { describe, it, expect } from "vitest";
import {
  stepPlayer,
  LocalPrediction,
  SPAWN_POINTS,
  DIR_DOWN,
  type InputMessage,
  type PlayerSim,
} from "@genzed/shared";
import { loadSolidityGrid } from "../sim/collision.js";

const grid = loadSolidityGrid();

function freshSim(): PlayerSim {
  const p = SPAWN_POINTS[2]; // (384, 416) — verified open floor
  if (!p) throw new Error("spawn missing");
  return { x: p.x, y: p.y, dir: DIR_DOWN, rollTicksLeft: 0, rollDirMask: 0, rollCooldownTicks: 0, speedBonus: 0 };
}

// The server path: a fresh sim object is built from schema fields for every
// input and the result written back (ArenaRoom.tick's exact dataflow).
class ServerSide {
  sim = freshSim();
  apply(input: InputMessage): void {
    this.sim = { ...stepPlayer(grid, { ...this.sim }, input).sim };
  }
}

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(seq: number, rnd: () => number): InputMessage {
  return {
    seq,
    up: rnd() < 0.3,
    down: rnd() < 0.3,
    left: rnd() < 0.3,
    right: rnd() < 0.3,
    roll: rnd() < 0.08,
    aimAngle: rnd() * Math.PI * 2 - Math.PI,
  };
}

describe("server/prediction sim parity (the ONE-simulation invariant)", () => {
  for (const reconcileEvery of [1, 3, 7]) {
    it(`stays exact over 400 random inputs, reconciling every ${reconcileEvery}`, () => {
      const rnd = mulberry32(42);
      const server = new ServerSide();
      const prediction = new LocalPrediction(freshSim(), grid, 1);
      for (let seq = 1; seq <= 400; seq += 1) {
        const input = randomInput(seq, rnd);
        const sent = prediction.sample(input, input.aimAngle);
        expect(sent.seq).toBe(seq);
        server.apply(sent);
        if (seq % reconcileEvery === 0) {
          prediction.reconcile({ ...server.sim }, seq);
          expect(prediction.x).toBe(server.sim.x);
          expect(prediction.y).toBe(server.sim.y);
        }
      }
      expect(prediction.sim).toEqual(server.sim);
    });
  }

  it("replays pending inputs exactly across a lagged ack (10 inputs behind)", () => {
    const rnd = mulberry32(7);
    const server = new ServerSide();
    const prediction = new LocalPrediction(freshSim(), grid, 1);
    const history: PlayerSim[] = [];
    for (let seq = 1; seq <= 60; seq += 1) {
      const input = randomInput(seq, rnd);
      prediction.sample(input, input.aimAngle);
      server.apply(input);
      history.push({ ...server.sim });
    }
    const ack = history[49]; // server state as of seq 50
    if (!ack) throw new Error("history missing");
    prediction.reconcile({ ...ack }, 50); // replay 51..60 on top
    expect(prediction.x).toBe(server.sim.x);
    expect(prediction.y).toBe(server.sim.y);
  });

  it("survives reconciles landing mid-roll", () => {
    const NO = { up: false, down: false, left: false, right: false, roll: false, aimAngle: 0 };
    const server = new ServerSide();
    const prediction = new LocalPrediction(freshSim(), grid, 1);
    const script = [
      { ...NO, roll: true, left: true }, // roll left
      ...Array.from({ length: 14 }, () => ({ ...NO, left: true })),
      { ...NO, roll: true, up: true }, // still cooling down — must be ignored identically
      ...Array.from({ length: 10 }, () => NO),
      { ...NO, roll: true, up: true, down: true }, // cancelled keys → facing roll
      ...Array.from({ length: 15 }, () => NO),
    ];
    script.forEach((partial, i) => {
      const seq = i + 1;
      const input: InputMessage = { ...partial, seq };
      prediction.sample(input, input.aimAngle);
      server.apply(input);
      if (seq === 5 || seq === 17 || seq === 30) {
        prediction.reconcile({ ...server.sim }, seq); // mid-roll, mid-cooldown, mid-third-roll
        expect(prediction.sim).toEqual(server.sim);
      }
    });
    prediction.reconcile({ ...server.sim }, script.length);
    expect(prediction.sim).toEqual(server.sim);
  });
});
