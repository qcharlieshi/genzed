import { Room, ServerError, type Client } from "@colyseus/core";
import {
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
  MSG_END_GAME,
  MSG_INPUT,
  MSG_START_GAME,
  MSG_FIRE,
  MSG_RELOAD,
  MSG_ACTIVE_RELOAD,
  MSG_DEV_TELEPORT,
  EVT_SHOT,
  EVT_LOG,
  EVT_RELOAD_RESULT,
  WIN_GUN_LEVEL,
  RELOAD_MS,
  RELOAD_JAM_TOTAL_MS,
  ACTIVE_RELOAD_WINDOW_MS,
  ACTIVE_RELOAD_DAMAGE_BONUS,
  ACTIVE_RELOAD_BONUS_MS,
  RESPAWN_IMMUNITY_MS,
  GUN_L5_SPEED_BONUS,
  WIN_BANNER_MS,
  TICK_MS,
  SPAWN_POINTS,
  DIR_DOWN,
  PLAYER_HEALTH,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  gunForLevel,
  stepPlayer,
  type InputMessage,
  type PlayerSim,
  type FireMessage,
  type ShotEvent,
  type ReloadResultEvent,
  type DevTeleportMessage,
  type LogEvent,
  type LogKind,
} from "@genzed/shared";
import { ArenaState, Player, Bullet } from "../schema/ArenaState.js";
import { loadSolidityGrid, loadBulletGrid } from "../sim/collision.js";
import { stepBullets, type BulletMeta, type Hit, type Target } from "../sim/bullets.js";

const MAX_CLIENTS = 4;
const MIN_TO_START = 2;
const COUNTDOWN_MS = 3000;
const COUNTDOWN_TICK_MS = 100;
const RECONNECT_SECONDS = 10;
const MAX_QUEUED_INPUTS = 10;
// Inputs simulated per player per tick. >1 lets a client catch up after network
// jitter; capping it stops an input flood from becoming a speed cheat (a full
// 10-deep drain per 50 ms tick would be 10x movement speed).
const MAX_INPUTS_PER_TICK = 2;

function isInputMessage(m: unknown): m is InputMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.seq === "number" &&
    Number.isInteger(o.seq) &&
    o.seq >= 0 &&
    o.seq < 4294967296 && // uint32 — lastProcessedInput compares unwrapped
    typeof o.up === "boolean" &&
    typeof o.down === "boolean" &&
    typeof o.left === "boolean" &&
    typeof o.right === "boolean" &&
    typeof o.roll === "boolean" &&
    typeof o.aimAngle === "number" &&
    Number.isFinite(o.aimAngle)
  );
}

type CombatMeta = {
  nextFireAt: number;
  reloadCompleteAt: number;
  activeReloadUsed: boolean;
  damageBonusUntil: number;
  bulletCounter: number;
  prevRank: number; // rank-change feed lines (Task 7)
};

function freshCombatMeta(): CombatMeta {
  return {
    nextFireAt: 0,
    reloadCompleteAt: 0,
    activeReloadUsed: false,
    damageBonusUntil: 0,
    bulletCounter: 0,
    prevRank: 0,
  };
}

const PLACES = ["1st", "2nd", "3rd", "4th"] as const;

function isDevTeleportMessage(m: unknown): m is DevTeleportMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    Number.isFinite(o.x) &&
    typeof o.y === "number" &&
    Number.isFinite(o.y)
  );
}

function isFireMessage(m: unknown): m is FireMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.tx === "number" &&
    Number.isFinite(o.tx) &&
    Math.abs(o.tx) <= WORLD_WIDTH * 2 &&
    typeof o.ty === "number" &&
    Number.isFinite(o.ty) &&
    Math.abs(o.ty) <= WORLD_HEIGHT * 2
  );
}

export class ArenaRoom extends Room<ArenaState> {
  // Set higher than MAX_CLIENTS so seat reservation always succeeds and
  // onAuth is the gating point for the 4-player cap (code 4003).
  override maxClients = 100;

  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private inputQueues = new Map<string, InputMessage[]>();
  private grid = loadSolidityGrid();
  private bulletGrid = loadBulletGrid();
  private combat = new Map<string, CombatMeta>();
  private bulletMeta = new Map<string, BulletMeta>();

  override onCreate(): void {
    this.setState(new ArenaState());
    this.onMessage(MSG_START_GAME, (client) => this.handleStartGame(client));
    this.onMessage(MSG_END_GAME, (client) => this.handleEndGame(client));
    this.onMessage(MSG_INPUT, (client, message: unknown) => this.handleInput(client, message));
    this.onMessage(MSG_FIRE, (client, message: unknown) => this.handleFire(client, message));
    this.onMessage(MSG_RELOAD, (client) => this.handleReload(client));
    this.onMessage(MSG_ACTIVE_RELOAD, (client) => this.handleActiveReload(client));
    this.onMessage(MSG_DEV_TELEPORT, (client, message: unknown) => this.handleDevTeleport(client, message));
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  override onAuth(_client: Client, _options: { name?: string }): boolean {
    if (this.state.phase !== "lobby") {
      throw new ServerError(CODE_GAME_IN_PROGRESS, "game in progress");
    }
    if (this.state.players.size >= MAX_CLIENTS) {
      throw new ServerError(CODE_LOBBY_FULL, "lobby full");
    }
    return true;
  }

  override onJoin(client: Client, options: { name?: string }): void {
    const player = new Player();
    player.name = (options.name ?? "anon").slice(0, 20).trim() || "anon";
    player.ready = false;
    player.joinedAt = Date.now();
    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);
    this.combat.set(client.sessionId, freshCombatMeta());
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    if (consented) {
      this.removePlayer(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      // Reconnected — sessionId preserved.
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  override onDispose(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private removePlayer(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.inputQueues.delete(sessionId);
    this.combat.delete(sessionId);
  }

  private handleInput(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isInputMessage(message)) return;
    const queue = this.inputQueues.get(client.sessionId);
    if (!queue) return;
    queue.push(message);
    if (queue.length > MAX_QUEUED_INPUTS) queue.shift();
  }

  private simFromPlayer(player: Player): PlayerSim {
    return {
      x: player.x,
      y: player.y,
      dir: player.dir,
      rollTicksLeft: player.rollTicksLeft,
      rollDirMask: player.rollDirMask,
      rollCooldownTicks: player.rollCooldownTicks,
      speedBonus: player.speedBonus,
    };
  }

  private tick(): void {
    if (this.state.phase !== "playing") return;
    this.state.tick += 1;
    this.state.players.forEach((player, sessionId) => {
      const queue = this.inputQueues.get(sessionId);
      if (!queue || queue.length === 0) return;
      queue.sort((a, b) => a.seq - b.seq);
      const batch = queue.splice(0, MAX_INPUTS_PER_TICK); // remainder stays queued
      for (const input of batch) {
        if (input.seq <= player.lastProcessedInput) continue; // dup/replay guard
        const r = stepPlayer(this.grid, this.simFromPlayer(player), input);
        // every PlayerSim field maps 1:1 onto schema fields — assign covers future sim fields too
        Object.assign(player, r.sim);
        player.vx = r.vx;
        player.vy = r.vy;
        player.lastProcessedInput = input.seq;
        player.aimAngle = input.aimAngle;
      }
    });
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const meta = this.combat.get(sessionId);
      if (!meta) return;
      if (player.reloadStartedAt > 0 && now >= meta.reloadCompleteAt) {
        player.ammo = gunForLevel(player.gunLevel).clip;
        player.reloadStartedAt = 0;
      }
    });
    // 2. Bullets: substepped integration vs bullet grid + player AABBs.
    const targets: Target[] = [];
    this.state.players.forEach((p, id) => {
      targets.push({ id, x: p.x, y: p.y, immune: p.immuneUntil > now });
    });
    const hits = stepBullets(this.bulletGrid, this.state.bullets, this.bulletMeta, targets, this.state.tick);
    for (const hit of hits) this.resolveHit(hit, now);
  }

  private handleFire(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isFireMessage(message)) return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.gunLevel >= WIN_GUN_LEVEL) return;
    if (player.rollTicksLeft > 0) return; // fire input ignored mid-roll
    if (player.reloadStartedAt > 0) return;
    const now = Date.now();
    if (now < meta.nextFireAt) return;
    if (player.ammo === 0) {
      this.beginReload(player, meta, now); // legacy: dry fire auto-reloads
      return;
    }
    const gun = gunForLevel(player.gunLevel);
    // Velocity from the AUTHORITATIVE position toward the requested point —
    // bullets converge on the point (legacy gun.js:95), one spawn at player center.
    const dx = message.tx - player.x;
    const dy = message.ty - player.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const bullet = new Bullet();
    bullet.x = player.x;
    bullet.y = player.y;
    bullet.vx = (dx / d) * gun.bulletSpeed;
    bullet.vy = (dy / d) * gun.bulletSpeed;
    bullet.level = player.gunLevel;
    bullet.spawnTick = this.state.tick;
    const id = `${client.sessionId}:${meta.bulletCounter}`;
    meta.bulletCounter += 1;
    this.state.bullets.set(id, bullet);
    this.bulletMeta.set(id, {
      shooterId: client.sessionId,
      damage: gun.damage + (now < meta.damageBonusUntil ? ACTIVE_RELOAD_DAMAGE_BONUS : 0),
      diesAtTick:
        gun.bulletLifetimeMs > 0
          ? this.state.tick + Math.max(1, Math.round(gun.bulletLifetimeMs / TICK_MS))
          : Number.MAX_SAFE_INTEGER,
    });
    if (player.ammo > 0) player.ammo -= 1; // -1 encodes ∞ (L5)
    meta.nextFireAt = now + gun.fireIntervalMs;
    const shot: ShotEvent = { shooterId: client.sessionId, level: player.gunLevel, x: player.x, y: player.y };
    this.broadcast(EVT_SHOT, shot);
  }

  private beginReload(player: Player, meta: CombatMeta, now: number): void {
    if (player.reloadStartedAt > 0) return;
    const gun = gunForLevel(player.gunLevel);
    if (gun.clip === -1 || player.ammo === gun.clip) return;
    player.reloadStartedAt = now;
    meta.reloadCompleteAt = now + RELOAD_MS;
    meta.activeReloadUsed = false;
  }

  private handleReload(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.rollTicksLeft > 0) return; // reload input ignored mid-roll
    this.beginReload(player, meta, Date.now());
  }

  private handleActiveReload(client: Client): void {
    if (this.state.phase !== "playing") return;
    const player = this.state.players.get(client.sessionId);
    const meta = this.combat.get(client.sessionId);
    if (!player || !meta) return;
    if (player.rollTicksLeft > 0) return;
    if (player.reloadStartedAt === 0 || meta.activeReloadUsed) return;
    const now = Date.now();
    if (now >= meta.reloadCompleteAt) return; // reload already done; tick will clear it
    meta.activeReloadUsed = true;
    const elapsed = now - player.reloadStartedAt;
    const [lo, hi] = ACTIVE_RELOAD_WINDOW_MS;
    let result: ReloadResultEvent;
    if (elapsed >= lo && elapsed <= hi) {
      player.ammo = gunForLevel(player.gunLevel).clip;
      player.reloadStartedAt = 0;
      meta.damageBonusUntil = now + ACTIVE_RELOAD_BONUS_MS;
      result = { ok: true };
    } else {
      meta.reloadCompleteAt = now + RELOAD_JAM_TOTAL_MS; // jam pushes completion out
      result = { ok: false };
    }
    client.send(EVT_RELOAD_RESULT, result);
  }

  private assignSpawns(): void {
    const points = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);
    let i = 0;
    this.state.players.forEach((player) => {
      const p = points[i % points.length];
      if (!p) return; // noUncheckedIndexedAccess; unreachable (points is non-empty)
      player.x = p.x;
      player.y = p.y;
      player.vx = 0;
      player.vy = 0;
      player.dir = DIR_DOWN;
      player.lastProcessedInput = 0;
      player.rollTicksLeft = 0;
      player.rollDirMask = 0;
      player.rollCooldownTicks = 0;
      player.speedBonus = 0;
      player.hp = PLAYER_HEALTH;
      player.gunLevel = 1;
      player.ammo = gunForLevel(1).clip;
      player.reloadStartedAt = 0;
      player.aimAngle = 0;
      player.immuneUntil = 0;
      i += 1;
    });
    this.state.bullets.clear();
    this.state.winnerName = "";
    this.combat.forEach((_meta, sessionId) => this.combat.set(sessionId, freshCombatMeta()));
    this.bulletMeta.clear();
    this.announceRankChanges(false);
  }

  private handleStartGame(_client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size < MIN_TO_START) return;
    this.state.phase = "starting";
    this.state.countdownMs = COUNTDOWN_MS;
    this.countdownInterval = setInterval(() => {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - COUNTDOWN_TICK_MS);
      if (this.state.countdownMs <= 0) {
        // Spawns are set before the phase flips so the first "playing" patch
        // already carries positions.
        this.assignSpawns();
        this.state.phase = "playing";
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
      }
    }, COUNTDOWN_TICK_MS);
  }

  private handleEndGame(_client: Client): void {
    if (this.state.phase !== "playing" && this.state.phase !== "ended") return;
    this.resetToLobby();
  }

  private broadcastLog(kind: LogKind, text: string): void {
    const log: LogEvent = { kind, text };
    this.broadcast(EVT_LOG, log);
  }

  private resolveHit(hit: Hit, now: number): void {
    const victim = this.state.players.get(hit.victimId);
    if (!victim) return;
    if (victim.immuneUntil > now) return; // killed-and-respawned earlier this same tick
    victim.hp = Math.max(0, victim.hp - hit.damage);
    if (victim.hp > 0) return;
    const shooter = this.state.players.get(hit.shooterId);
    this.broadcastLog("slain", `${shooter?.name ?? "?"} has slain ${victim.name}`);
    this.respawn(victim, now);
    if (!shooter || shooter.gunLevel >= WIN_GUN_LEVEL) return;
    shooter.gunLevel += 1;
    if (shooter.gunLevel >= WIN_GUN_LEVEL) {
      this.handleWin(shooter);
      return;
    }
    const gun = gunForLevel(shooter.gunLevel);
    shooter.ammo = gun.clip;
    shooter.reloadStartedAt = 0; // new gun arrives loaded
    shooter.speedBonus = shooter.gunLevel === 5 ? GUN_L5_SPEED_BONUS : 0;
    this.broadcastLog("levelup", `${shooter.name} has advanced to Gun Level: ${shooter.gunLevel}`);
    this.announceRankChanges(true);
  }

  private respawn(player: Player, now: number): void {
    const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    if (!p) return; // noUncheckedIndexedAccess; unreachable (non-empty table)
    player.x = p.x;
    player.y = p.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = PLAYER_HEALTH;
    player.immuneUntil = now + RESPAWN_IMMUNITY_MS;
    player.rollTicksLeft = 0;
    player.rollDirMask = 0;
    player.rollCooldownTicks = 0;
    // lastProcessedInput is NOT reset — the replay-guard watermark must survive.
  }

  // Deviation 8: announce the player whose rank improved, by name.
  private announceRankChanges(announce: boolean): void {
    const order: Array<[string, Player]> = [];
    this.state.players.forEach((p, id) => order.push([id, p]));
    order.sort(([, a], [, b]) => b.gunLevel - a.gunLevel || a.joinedAt - b.joinedAt);
    order.forEach(([sessionId, player], rank) => {
      const meta = this.combat.get(sessionId);
      if (!meta) return;
      if (announce && rank < meta.prevRank) {
        this.broadcastLog("rank", `${player.name} has taken ${PLACES[rank] ?? `${rank + 1}th`} place`);
      }
      meta.prevRank = rank;
    });
  }

  private handleWin(winner: Player): void {
    this.state.winnerName = winner.name;
    this.state.phase = "ended";
    this.broadcastLog("win", `${winner.name} has won the game!`);
    this.state.bullets.clear();
    this.bulletMeta.clear();
    this.clock.setTimeout(() => {
      if (this.state.phase === "ended") this.resetToLobby();
    }, WIN_BANNER_MS);
  }

  private resetToLobby(): void {
    this.state.phase = "lobby";
    this.state.countdownMs = 0;
    this.state.winnerName = "";
    this.state.bullets.clear();
    this.bulletMeta.clear();
    this.inputQueues.forEach((queue) => {
      queue.length = 0;
    });
    this.state.players.forEach((player) => {
      player.ready = false;
    });
  }

  private handleDevTeleport(client: Client, message: unknown): void {
    if (this.state.phase !== "playing") return;
    if (!isDevTeleportMessage(message)) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.x = message.x;
    player.y = message.y;
    player.vx = 0;
    player.vy = 0;
    player.rollTicksLeft = 0;
  }
}
