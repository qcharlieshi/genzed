import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_INPUT,
  MSG_FIRE,
  MSG_RELOAD,
  MSG_ACTIVE_RELOAD,
  EVT_RELOAD_RESULT,
  RELOAD_MS,
  type ReloadResultEvent,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

afterEach(async () => {
  await colyseus?.shutdown();
  await new Promise((r) => setTimeout(r, 150));
});

const IDLE = { up: false, down: false, left: false, right: false, roll: false, aimAngle: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startedGame() {
  colyseus = await boot(appConfig);
  const room = await colyseus.createRoom<ArenaState>("arena", {});
  const c1 = await colyseus.connectTo(room, { name: "a" });
  const c2 = await colyseus.connectTo(room, { name: "b" });
  // Swallow broadcasts the SDK would otherwise warn about.
  c1.onMessage("*", () => {});
  c2.onMessage("*", () => {});
  c1.send(MSG_START_GAME);
  await sleep(3300); // real 3 s countdown
  expect(room.state.phase).toBe("playing");
  const p1 = room.state.players.get(c1.sessionId);
  const p2 = room.state.players.get(c2.sessionId);
  if (!p1 || !p2) throw new Error("players missing");
  return { room, c1, c2, p1, p2 };
}

describe("game-start combat reset", () => {
  it("initializes hp/gun/ammo on entering playing", async () => {
    const { p1 } = await startedGame();
    expect(p1.hp).toBe(100);
    expect(p1.gunLevel).toBe(1);
    expect(p1.ammo).toBe(10);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);
});

describe("fire gates", () => {
  it("spawns a bullet flying toward the target and spends ammo", async () => {
    const { room, c1, p1 } = await startedGame();
    // (128,128) firing right along the verified-clear row to (992,128) — the
    // bullet must still be alive when we look (Task 7 makes bullets move and
    // die on walls; a fire ray with a wall ~60 px out would vaporize it).
    p1.x = 128;
    p1.y = 128;
    c1.send(MSG_FIRE, { tx: 228, ty: 128 });
    await sleep(150);
    expect(room.state.bullets.size).toBe(1);
    const bullet = [...room.state.bullets.values()][0];
    if (!bullet) throw new Error("bullet missing");
    expect(bullet.vx).toBeCloseTo(500, 3); // pistol speed, straight right
    expect(bullet.vy).toBeCloseTo(0, 3);
    expect(bullet.level).toBe(1);
    expect(p1.ammo).toBe(9);
  }, 10_000);

  it("rate-limits to the gun's fire interval", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.x = 128;
    p1.y = 128; // clear fire ray — see above
    c1.send(MSG_FIRE, { tx: 228, ty: 128 });
    c1.send(MSG_FIRE, { tx: 228, ty: 128 }); // inside the 350 ms pistol interval
    await sleep(150);
    expect(room.state.bullets.size).toBe(1);
    expect(p1.ammo).toBe(9);
  }, 10_000);

  it("rejects malformed fire payloads", async () => {
    const { room, c1 } = await startedGame();
    c1.send(MSG_FIRE, { tx: "nope" });
    c1.send(MSG_FIRE, { tx: Infinity, ty: 0 });
    await sleep(150);
    expect(room.state.bullets.size).toBe(0);
    expect(room.state.phase).toBe("playing"); // room alive
  }, 10_000);

  it("blocks fire while reloading", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.ammo = 4;
    c1.send(MSG_RELOAD);
    await sleep(100);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
  }, 10_000);

  it("dry fire auto-reloads instead of shooting (legacy behavior)", async () => {
    const { room, c1, p1 } = await startedGame();
    p1.ammo = 0;
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    await sleep(RELOAD_MS + 300); // tick completes the reload
    expect(p1.reloadStartedAt).toBe(0);
    expect(p1.ammo).toBe(10);
  }, 10_000);

  it("blocks fire mid-roll", async () => {
    const { room, c1 } = await startedGame();
    c1.send(MSG_INPUT, { ...IDLE, seq: 1, roll: true, right: true });
    await sleep(120); // roll is 600 ms; we're inside it
    c1.send(MSG_FIRE, { tx: 484, ty: 416 });
    await sleep(100);
    expect(room.state.bullets.size).toBe(0);
  }, 10_000);
});

describe("reload + active reload", () => {
  it("ignores reload with a full clip", async () => {
    const { c1, p1 } = await startedGame();
    c1.send(MSG_RELOAD);
    await sleep(100);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);

  it("active reload inside [1350,1650] ms refills instantly and reports ok", async () => {
    const { c1, p1 } = await startedGame();
    const results: ReloadResultEvent[] = [];
    c1.onMessage(EVT_RELOAD_RESULT, (m: ReloadResultEvent) => results.push(m));
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(1450); // mid-window
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(results).toEqual([{ ok: true }]);
    expect(p1.ammo).toBe(10);
    expect(p1.reloadStartedAt).toBe(0);
  }, 10_000);

  it("active reload outside the window jams: completion pushed past normal", async () => {
    const { c1, p1 } = await startedGame();
    const results: ReloadResultEvent[] = [];
    c1.onMessage(EVT_RELOAD_RESULT, (m: ReloadResultEvent) => results.push(m));
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(300); // way early
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(results).toEqual([{ ok: false }]);
    // At T+2300 a normal reload (2000 ms) would be done — the jam isn't.
    await sleep(1850);
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
    expect(p1.ammo).toBe(3);
  }, 10_000);

  it("allows only one active-reload attempt per reload", async () => {
    const { c1, p1 } = await startedGame();
    p1.ammo = 3;
    c1.send(MSG_RELOAD);
    await sleep(300);
    c1.send(MSG_ACTIVE_RELOAD); // jam
    await sleep(1150); // now at ~1450 — inside the window, but attempt is spent
    c1.send(MSG_ACTIVE_RELOAD);
    await sleep(150);
    expect(p1.ammo).toBe(3); // no refill
    expect(p1.reloadStartedAt).toBeGreaterThan(0);
  }, 10_000);
});
