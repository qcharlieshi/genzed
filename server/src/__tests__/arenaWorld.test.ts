import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_END_GAME,
  MSG_FIRE,
  MSG_DEV_ZOMBIE_SPAWNING,
  MSG_DEV_SPAWN_ZOMBIE,
  EVT_ZOMBIE_ATTACK,
  ZOMBIE_SPAWN_POINTS,
  ZOMBIE_ATTACK_DAMAGE,
  type ZombieAttackEvent,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  c1.onMessage("*", () => {});
  c2.onMessage("*", () => {});
  c1.send(MSG_START_GAME);
  await sleep(3300);
  expect(room.state.phase).toBe("playing");
  const p1 = room.state.players.get(c1.sessionId);
  const p2 = room.state.players.get(c2.sessionId);
  if (!p1 || !p2) throw new Error("players missing");
  return { room, c1, c2, p1, p2 };
}

describe("zombie spawner + combat", () => {
  it("spawns naturally on the interval at a table point; dev toggle clears and stops", async () => {
    const { room, c1 } = await startedGame();
    await sleep(4300); // first spawn lands at tick 80 (4 s)
    expect(room.state.zombies.size).toBeGreaterThanOrEqual(1);
    const z = [...room.state.zombies.values()][0];
    if (!z) throw new Error("zombie missing");
    // Spawned AT a table point — by now it has chased, so check it spawned near one.
    const near = ZOMBIE_SPAWN_POINTS.some((p) => Math.hypot(p.x - z.x, p.y - z.y) < 200);
    expect(near).toBe(true);
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false });
    await sleep(150);
    expect(room.state.zombies.size).toBe(0);
    await sleep(4200); // a full interval passes — nothing respawns
    expect(room.state.zombies.size).toBe(0);
  }, 20_000);

  it("zombie closes on the nearest player and attacks for 5 on a 1 s cadence", async () => {
    const { room, c1, c2, p1, p2 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false }); // no strays
    const attacks: ZombieAttackEvent[] = [];
    c2.onMessage(EVT_ZOMBIE_ATTACK, (m: ZombieAttackEvent) => attacks.push(m));
    await sleep(150);
    // VERIFIED fixture (player grid): the corridor y=128, x 128..200 is
    // AABB-clear — the zombie has a straight walk to the player.
    p1.x = 128;
    p1.y = 128;
    p1.immuneUntil = 0;
    p2.x = 992;
    p2.y = 992; // far away — the zombie must pick p1 (nearest)
    c1.send(MSG_DEV_SPAWN_ZOMBIE, { x: 188, y: 128 }); // dev seam plants meta too
    await sleep(150);
    const zombie = [...room.state.zombies.values()][0];
    if (!zombie) throw new Error("dev spawn failed");
    const startDist = Math.hypot(zombie.x - p1.x, zombie.y - p1.y); // ≤60 px (it may have stepped)
    await sleep(450); // ~8 ticks at 91 px/s ≈ 36 px closer
    expect(Math.hypot(zombie.x - p1.x, zombie.y - p1.y)).toBeLessThan(startDist);
    await sleep(1600); // reaches 28 px range (~0.4 s in) and swings at least once
    expect(p1.hp).toBeLessThanOrEqual(100 - ZOMBIE_ATTACK_DAMAGE);
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    expect(attacks.length).toBeLessThanOrEqual(4); // 1/s cadence (~2 s in range + runner-stall slack); unthrottled would be ~40
  }, 20_000);

  it("one bullet kills a zombie, awards nothing, and the bullet is consumed", async () => {
    const { room, c1, p1, p2 } = await startedGame();
    c1.send(MSG_DEV_ZOMBIE_SPAWNING, { enabled: false });
    await sleep(150);
    // VERIFIED fixture: the y=128 ray is clear across the row on the BULLET
    // grid, while the player-grid tile (7,3) stops the chasing zombie at
    // x≈264 — it can never reach the shooter, it dies on the firing line.
    p1.x = 128;
    p1.y = 128;
    p2.x = 992;
    p2.y = 992; // out of the line of fire
    c1.send(MSG_DEV_SPAWN_ZOMBIE, { x: 300, y: 128 });
    await sleep(150);
    expect(room.state.zombies.size).toBe(1);
    c1.send(MSG_FIRE, { tx: 300, ty: 128 });
    await sleep(700); // ≤172 px at 500 px/s + tick slack; zombie closes toward the line
    expect(room.state.zombies.size).toBe(0);
    expect(room.state.bullets.size).toBe(0);
    expect(p1.gunLevel).toBe(1); // no credit for zombie kills
    expect(p1.hp).toBe(100); // the wall-stuck zombie never reached attack range
  }, 20_000);

  it("game-start and win/reset clear zombies", async () => {
    const { room, c1 } = await startedGame();
    await sleep(4300);
    expect(room.state.zombies.size).toBeGreaterThanOrEqual(1);
    c1.send(MSG_END_GAME); // dev reset seam (pre-existing)
    await sleep(200);
    expect(room.state.phase).toBe("lobby");
    expect(room.state.zombies.size).toBe(0);
  }, 20_000);
});
