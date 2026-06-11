import { Room, ServerError, type Client } from "@colyseus/core";
import {
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
  MSG_END_GAME,
  MSG_INPUT,
  MSG_START_GAME,
  TICK_MS,
  SPAWN_POINTS,
  DIR_DOWN,
  PLAYER_HEALTH,
  gunForLevel,
  stepPlayer,
  type InputMessage,
  type PlayerSim,
} from "@genzed/shared";
import { ArenaState, Player } from "../schema/ArenaState.js";
import { loadSolidityGrid } from "../sim/collision.js";

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

export class ArenaRoom extends Room<ArenaState> {
  // Set higher than MAX_CLIENTS so seat reservation always succeeds and
  // onAuth is the gating point for the 4-player cap (code 4003).
  override maxClients = 100;

  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private inputQueues = new Map<string, InputMessage[]>();
  private grid = loadSolidityGrid();

  override onCreate(): void {
    this.setState(new ArenaState());
    this.onMessage(MSG_START_GAME, (client) => this.handleStartGame(client));
    this.onMessage(MSG_END_GAME, (client) => this.handleEndGame(client));
    this.onMessage(MSG_INPUT, (client, message: unknown) => this.handleInput(client, message));
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
    if (this.state.phase !== "playing") return;
    this.state.phase = "lobby";
    this.state.countdownMs = 0;
    this.inputQueues.forEach((queue) => {
      queue.length = 0;
    });
    this.state.players.forEach((player) => {
      player.ready = false;
    });
  }
}
