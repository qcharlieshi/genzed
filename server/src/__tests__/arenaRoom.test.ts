import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_END_GAME,
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

async function bootOnce(): Promise<ColyseusTestServer> {
  colyseus = await boot(appConfig);
  return colyseus;
}

afterEach(async () => {
  await colyseus?.shutdown();
  // Small delay so the OS releases port 2568 before the next test boots a new server.
  await new Promise((r) => setTimeout(r, 150));
});

describe("ArenaRoom — initial state", () => {
  it("starts in lobby phase with no players", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.size).toBe(0);
    expect(room.state.countdownMs).toBe(0);
  });
});

describe("ArenaRoom — join", () => {
  it("accepts a client joining with a name", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const client = await cs.connectTo(room, { name: "alice" });
    await client.waitForNextPatch();
    expect(room.state.players.size).toBe(1);
    const player = room.state.players.get(client.sessionId);
    if (!player) throw new Error("player not found");
    expect(player.name).toBe("alice");
    expect(player.ready).toBe(false);
    expect(player.joinedAt).toBeGreaterThan(0);
  });

  it("rejects joining when the lobby is full (4 players)", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    await cs.connectTo(room, { name: "c" });
    await cs.connectTo(room, { name: "d" });
    await expect(cs.connectTo(room, { name: "e" })).rejects.toMatchObject({
      code: CODE_LOBBY_FULL,
    });
  });
});

describe("ArenaRoom — start_game", () => {
  it("is a no-op with one player", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "solo" });
    c1.send(MSG_START_GAME);
    await c1.waitForNextPatch().catch(() => {});
    // Phase did not change.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownMs).toBe(0);
  });

  it("transitions lobby → starting → playing with two players", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const c2 = await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    // Wait until phase becomes "starting" (within a tick or two).
    await c2.waitForMessage("__irrelevant__").catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    expect(room.state.phase).toBe("starting");
    expect(room.state.countdownMs).toBeGreaterThan(0);
    // Wait long enough for the 3s countdown to complete.
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    expect(room.state.countdownMs).toBe(0);
  });
});

describe("ArenaRoom — join while playing", () => {
  it("rejects with code 4001", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    // Wait through countdown.
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    await expect(cs.connectTo(room, { name: "late" })).rejects.toMatchObject({
      code: CODE_GAME_IN_PROGRESS,
    });
  });
});

describe("ArenaRoom — end_game (dev hook)", () => {
  it("returns to lobby and resets countdownMs", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    c1.send(MSG_END_GAME);
    await new Promise((r) => setTimeout(r, 100));
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownMs).toBe(0);
    // Players retained.
    expect(room.state.players.size).toBe(2);
  });
});

describe("ArenaRoom — reconnection", () => {
  it("retains the slot if the client reconnects within the grace period", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const sessionId = c1.sessionId;
    const reconnectionToken = c1.reconnectionToken;
    // Simulate ungraceful disconnect.
    c1.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    // Player still in state during grace.
    expect(room.state.players.has(sessionId)).toBe(true);
    // Reconnect using the token.
    const c1again = await cs.sdk.reconnect(reconnectionToken);
    await c1again.waitForNextPatch();
    expect(room.state.players.has(c1again.sessionId)).toBe(true);
    expect(c1again.sessionId).toBe(sessionId);
  });

  it("removes the player when reconnection grace expires", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const sessionId = c1.sessionId;
    c1.leave(false);
    // RECONNECT_SECONDS = 10 in the room; wait 11s.
    await new Promise((r) => setTimeout(r, 11_000));
    expect(room.state.players.has(sessionId)).toBe(false);
  }, 15_000);
});
