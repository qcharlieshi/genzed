import { Room, ServerError, type Client, type Delayed } from "@colyseus/core";
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
  EVT_ZOMBIE_ATTACK,
  MSG_DEV_ZOMBIE_SPAWNING,
  MSG_DEV_SPAWN_ZOMBIE,
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
  ZOMBIE_SPAWN_INTERVAL_MS,
  ZOMBIE_MAX_ALIVE,
  ZOMBIE_SPAWN_POINTS,
  PICKUP_KIND_HEALTH,
  SPEED_PICKUP_BONUS,
  SPEED_PICKUP_MS,
  PICKUP_RESPAWN_MS,
  PICKUP_SLOTS,
  PICKUP_INITIAL,
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
  type ZombieAttackEvent,
  type DevZombieSpawningMessage,
} from "@genzed/shared";
import { ArenaState, Player, Bullet, Zombie, Pickup } from "../schema/ArenaState.js";
import { loadSolidityGrid, loadBulletGrid } from "../sim/collision.js";
import { stepBullets, type BulletMeta, type Hit, type Target } from "../sim/bullets.js";
import { stepZombies, type ZombieMeta } from "../sim/zombies.js";
import { applyHealthPickup, overlapsPickup, pickRespawnSlot } from "../sim/pickups.js";

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
const ZOMBIE_SPAWN_TICKS = ZOMBIE_SPAWN_INTERVAL_MS / TICK_MS; // 80 ticks = 4 s

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
  speedBoostUntil: number; // server-clock ms; 0 = no speed pickup active
};

function freshCombatMeta(): CombatMeta {
  return {
    nextFireAt: 0,
    reloadCompleteAt: 0,
    activeReloadUsed: false,
    damageBonusUntil: 0,
    bulletCounter: 0,
    prevRank: 0,
    speedBoostUntil: 0,
  };
}

// speedBonus is the SUM of its two sources — the L5 gun bonus and a live
// speed pickup. Every write to player.speedBonus goes through here so one
// source can't clobber the other.
function computeSpeedBonus(player: Player, speedBoostUntil: number, now: number): number {
  return (
    (player.gunLevel === 5 ? GUN_L5_SPEED_BONUS : 0) + (speedBoostUntil > now ? SPEED_PICKUP_BONUS : 0)
  );
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

function isDevZombieSpawningMessage(m: unknown): m is DevZombieSpawningMessage {
  if (typeof m !== "object" || m === null) return false;
  return typeof (m as Record<string, unknown>).enabled === "boolean";
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
  private winTimer: Delayed | null = null;
  private inputQueues = new Map<string, InputMessage[]>();
  private grid = loadSolidityGrid();
  private bulletGrid = loadBulletGrid();
  private combat = new Map<string, CombatMeta>();
  private bulletMeta = new Map<string, BulletMeta>();
  private zombieMeta = new Map<string, ZombieMeta>();
  private zombieCounter = 0;
  private zombieSpawning = true; // dev seam can disable for E2E determinism
  private nextZombieSpawnTick = 0; // anchored at game start (state.tick never resets)
  private pickupSlotById = new Map<string, number>(); // live pickup id → slot index
  private pickupCounter = 0;
  private pickupRespawns: Array<{ kind: number; at: number }> = [];

  override onCreate(): void {
    this.setState(new ArenaState());
    this.onMessage(MSG_START_GAME, (client) => this.handleStartGame(client));
    this.onMessage(MSG_END_GAME, (client) => this.handleEndGame(client));
    this.onMessage(MSG_INPUT, (client, message: unknown) => this.handleInput(client, message));
    this.onMessage(MSG_FIRE, (client, message: unknown) => this.handleFire(client, message));
    this.onMessage(MSG_RELOAD, (client) => this.handleReload(client));
    this.onMessage(MSG_ACTIVE_RELOAD, (client) => this.handleActiveReload(client));
    if (process.env.NODE_ENV !== "production") {
      this.onMessage(MSG_DEV_TELEPORT, (client, message: unknown) =>
        this.handleDevTeleport(client, message),
      );
      this.onMessage(MSG_DEV_ZOMBIE_SPAWNING, (_client, message: unknown) => {
        if (!isDevZombieSpawningMessage(message)) return;
        this.zombieSpawning = message.enabled;
        if (!message.enabled) {
          this.state.zombies.clear();
          this.zombieMeta.clear();
        }
      });
      this.onMessage(MSG_DEV_SPAWN_ZOMBIE, (_client, message: unknown) => {
        if (this.state.phase !== "playing") return;
        if (!isDevTeleportMessage(message)) return; // same { x, y } finite-number shape
        this.spawnZombieAt(message.x, message.y);
      });
    }
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
      if (meta.speedBoostUntil > 0 && now >= meta.speedBoostUntil) {
        meta.speedBoostUntil = 0;
        player.speedBonus = computeSpeedBonus(player, 0, now);
      }
    });
    // 2. Bullets: substepped integration vs bullet grid + player AABBs.
    const targets: Target[] = [];
    this.state.players.forEach((p, id) => {
      targets.push({ id, x: p.x, y: p.y, immune: p.immuneUntil > now, kind: "player" });
    });
    this.state.zombies.forEach((z, id) => {
      targets.push({ id, x: z.x, y: z.y, immune: false, kind: "zombie" });
    });
    const hits = stepBullets(this.bulletGrid, this.state.bullets, this.bulletMeta, targets, this.state.tick);
    for (const hit of hits) {
      if (this.state.phase !== "playing") break; // a hit in this batch just ended the game
      this.resolveHit(hit, now);
    }

    if (this.state.phase !== "playing") return; // a bullet kill may have ended the game

    // 3. Zombies: retarget nearest, steer, attack.
    const playerTargets = targets.filter((t) => t.kind === "player");
    const attacks = stepZombies(this.grid, this.state.zombies, this.zombieMeta, playerTargets, now);
    for (const attack of attacks) {
      const victim = this.state.players.get(attack.victimId);
      if (!victim) continue;
      // playerTargets carries pre-bullet immune flags — a bullet kill this
      // same tick already respawned (and immunized) the victim; re-check.
      if (victim.immuneUntil > now) continue;
      victim.hp = Math.max(0, victim.hp - attack.damage); // uint8 — never assign negative
      const evt: ZombieAttackEvent = { x: attack.x, y: attack.y };
      this.broadcast(EVT_ZOMBIE_ATTACK, evt);
      // Zombie kills: respawn only — no feed line, no credit (legacy-verified, addendum 4).
      if (victim.hp === 0) this.respawn(victim, now);
    }

    // 4a. Zombie spawner: one per interval up to the cap. Anchored to a
    // next-spawn tick set at game start — state.tick never resets across
    // games, so a modulo check would drift later games' first spawn.
    if (this.zombieSpawning && this.state.tick >= this.nextZombieSpawnTick) {
      this.nextZombieSpawnTick = this.state.tick + ZOMBIE_SPAWN_TICKS;
      if (this.state.zombies.size < ZOMBIE_MAX_ALIVE) this.spawnZombie();
    }

    // 4b. Pickups: collection by player-AABB overlap, then respawn timers.
    this.tickPickups(now);
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
    this.state.zombies.clear();
    this.zombieMeta.clear();
    this.nextZombieSpawnTick = this.state.tick + ZOMBIE_SPAWN_TICKS;
    this.state.winnerName = "";
    this.combat.forEach((_meta, sessionId) => this.combat.set(sessionId, freshCombatMeta()));
    this.bulletMeta.clear();
    this.state.pickups.clear();
    this.pickupSlotById.clear();
    this.pickupRespawns = [];
    for (const init of PICKUP_INITIAL) this.placePickup(init.kind, init.slot);
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
    if (hit.victimKind === "zombie") {
      // One-hit-kill, no credit, no feed line (spec). Client plays the corpse anim.
      this.state.zombies.delete(hit.victimId);
      this.zombieMeta.delete(hit.victimId);
      return;
    }
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
    const shooterMeta = this.combat.get(hit.shooterId);
    shooter.speedBonus = computeSpeedBonus(shooter, shooterMeta?.speedBoostUntil ?? 0, now);
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
    this.state.zombies.clear();
    this.zombieMeta.clear();
    this.winTimer = this.clock.setTimeout(() => {
      if (this.state.phase === "ended") this.resetToLobby();
    }, WIN_BANNER_MS);
  }

  private resetToLobby(): void {
    this.winTimer?.clear();
    this.winTimer = null;
    this.state.phase = "lobby";
    this.state.countdownMs = 0;
    this.state.winnerName = "";
    this.state.bullets.clear();
    this.bulletMeta.clear();
    this.state.zombies.clear();
    this.zombieMeta.clear();
    this.state.pickups.clear();
    this.pickupSlotById.clear();
    this.pickupRespawns = [];
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

  private spawnZombie(): void {
    const p = ZOMBIE_SPAWN_POINTS[Math.floor(Math.random() * ZOMBIE_SPAWN_POINTS.length)];
    if (!p) return; // noUncheckedIndexedAccess; unreachable (non-empty table)
    this.spawnZombieAt(p.x, p.y);
  }

  private spawnZombieAt(x: number, y: number): void {
    const zombie = new Zombie();
    zombie.x = x;
    zombie.y = y;
    const id = `z${this.zombieCounter}`;
    this.zombieCounter += 1;
    this.state.zombies.set(id, zombie);
    this.zombieMeta.set(id, { nextAttackAt: 0 });
  }

  private placePickup(kind: number, slot: number): void {
    const s = PICKUP_SLOTS[slot];
    if (!s) return; // noUncheckedIndexedAccess; slot indices come from the table
    const pickup = new Pickup();
    pickup.x = s.x;
    pickup.y = s.y;
    pickup.kind = kind;
    const id = `p${this.pickupCounter}`;
    this.pickupCounter += 1;
    this.state.pickups.set(id, pickup);
    this.pickupSlotById.set(id, slot);
  }

  private tickPickups(now: number): void {
    // Collection — first overlapping player wins; immune players may collect
    // (legacy overlap had no immunity check).
    const collected: string[] = [];
    this.state.pickups.forEach((pickup, id) => {
      let taken = false;
      this.state.players.forEach((player, sessionId) => {
        if (taken || !overlapsPickup(player.x, player.y, pickup.x, pickup.y)) return;
        const meta = this.combat.get(sessionId);
        if (!meta) return;
        taken = true;
        if (pickup.kind === PICKUP_KIND_HEALTH) {
          player.hp = applyHealthPickup(player.hp);
          this.broadcastLog("pickup", `${player.name} has picked up a health pack!`);
        } else {
          meta.speedBoostUntil = now + SPEED_PICKUP_MS; // refreshes, never stacks (deviation 4)
          player.speedBonus = computeSpeedBonus(player, meta.speedBoostUntil, now);
          this.broadcastLog("pickup", `${player.name} has picked up a speed boost!`);
        }
        this.pickupRespawns.push({ kind: pickup.kind, at: now + PICKUP_RESPAWN_MS });
      });
      if (taken) collected.push(id);
    });
    for (const id of collected) {
      this.state.pickups.delete(id);
      this.pickupSlotById.delete(id);
    }
    // Respawns due → random unoccupied slot (legacy strings).
    if (this.pickupRespawns.length > 0) {
      const due = this.pickupRespawns.filter((r) => now >= r.at);
      this.pickupRespawns = this.pickupRespawns.filter((r) => now < r.at);
      for (const r of due) {
        const occupied = new Set(this.pickupSlotById.values());
        const slot = pickRespawnSlot(occupied);
        if (slot === -1) continue;
        this.placePickup(r.kind, slot);
        const item = r.kind === PICKUP_KIND_HEALTH ? "health pack" : "speed boost";
        this.broadcastLog("pickup", `A new ${item} has been placed!`);
      }
    }
  }
}
