import type { Phase } from "@genzed/shared";

// @colyseus/schema 2.x instance callbacks are callable and return a detach fn —
// cast at call sites like the existing players.onAdd usage.
export type SchemaCallbacks = {
  onChange: (cb: () => void) => unknown;
};

export type LobbyPlayer = SchemaCallbacks & {
  name: string;
  ready: boolean;
  joinedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  lastProcessedInput: number;
  rollTicksLeft: number;
  rollDirMask: number;
  rollCooldownTicks: number;
  speedBonus: number;
  hp: number;
  gunLevel: number;
  ammo: number;
  reloadStartedAt: number;
  aimAngle: number;
  immuneUntil: number;
};

export type BulletView = SchemaCallbacks & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  level: number;
  spawnTick: number;
};

export type SchemaMap<T> = {
  size: number;
  forEach(cb: (item: T, key: string) => void): void;
  get(key: string): T | undefined;
  values(): IterableIterator<T>;
  keys(): IterableIterator<string>;
  onAdd: (cb: (item: T, key: string) => void) => unknown;
  onRemove: (cb: (item: T, key: string) => void) => unknown;
};

export type LobbyPlayers = SchemaMap<LobbyPlayer>;

export type ArenaState = {
  phase: Phase;
  countdownMs: number;
  tick: number;
  winnerName: string;
  players: LobbyPlayers;
  bullets: SchemaMap<BulletView>;
  // schema 2.x property listener — callable, returns a detach fn
  listen: (
    prop: "phase" | "countdownMs" | "winnerName" | "tick",
    cb: (value: unknown, previous: unknown) => void,
  ) => unknown;
};
