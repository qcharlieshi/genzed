import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import { MSG_START_GAME, MSG_INPUT, SPAWN_POINTS } from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const IDLE = { up: false, down: false, left: false, right: false };

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  c1.send(MSG_START_GAME);
  await new Promise((r) => setTimeout(r, 3300)); // real 3 s countdown
  expect(room.state.phase).toBe("playing");
  return { room, c1, c2 };
}

describe("spawn assignment", () => {
  it("places each player on a distinct legacy spawn point", async () => {
    const { room, c1, c2 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    if (!p1 || !p2) throw new Error("players missing");
    const spawnSet = new Set(SPAWN_POINTS.map((p) => `${p.x},${p.y}`));
    expect(spawnSet.has(`${p1.x},${p1.y}`)).toBe(true);
    expect(spawnSet.has(`${p2.x},${p2.y}`)).toBe(true);
    expect(`${p1.x},${p1.y}`).not.toBe(`${p2.x},${p2.y}`);
  }, 10_000);
});

describe("input processing", () => {
  it("applies inputs in order and acks lastProcessedInput", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    c1.send(MSG_INPUT, { ...IDLE, seq: 2, up: true });
    c1.send(MSG_INPUT, { ...IDLE, seq: 3, up: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(p1.y).toBeCloseTo(startY - 15, 1); // 3 inputs × 5 px, walking up
    expect(p1.lastProcessedInput).toBe(3);
  }, 10_000);

  it("ignores replayed sequence numbers", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 200));
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true }); // replay
    await new Promise((r) => setTimeout(r, 200));
    expect(p1.y).toBeCloseTo(startY - 5, 1); // only one processed
    expect(p1.lastProcessedInput).toBe(1);
  }, 10_000);

  it("ignores inputs outside the playing phase", async () => {
    colyseus = await boot(appConfig);
    const room = await colyseus.createRoom<ArenaState>("arena", {});
    const c1 = await colyseus.connectTo(room, { name: "solo" });
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 300));
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    expect(p1.x).toBe(0);
    expect(p1.y).toBe(0);
    expect(p1.lastProcessedInput).toBe(0);
  });

  it("survives malformed input payloads", async () => {
    const { room, c1 } = await startedGame();
    const p1 = room.state.players.get(c1.sessionId);
    if (!p1) throw new Error("player missing");
    const startY = p1.y;
    c1.send(MSG_INPUT, { garbage: true });
    c1.send(MSG_INPUT, { seq: "nope", up: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(room.state.phase).toBe("playing"); // room alive
    expect(p1.y).toBe(startY);
    // And valid input still works afterwards.
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, up: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(p1.y).toBeCloseTo(startY - 5, 1);
  }, 10_000);
});
