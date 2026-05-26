import { describe, it, expect, afterAll } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState, Player } from "../schema/ArenaState.js";

let colyseus: ColyseusTestServer;

describe("ArenaRoom", () => {
  it("accepts a client joining with a name", async () => {
    colyseus = await boot(appConfig);
    const room = await colyseus.createRoom<ArenaState>("arena", {});
    const client = await colyseus.connectTo(room, { name: "alice" });
    await client.waitForNextPatch();
    expect(room.state.players.size).toBe(1);
    const players = Array.from(room.state.players.values()) as Player[];
    const player = players[0];
    if (!player) throw new Error("player not found");
    expect(player.name).toBe("alice");
  });

  afterAll(async () => {
    await colyseus?.shutdown();
  });
});
