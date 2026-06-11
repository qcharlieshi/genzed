import type { Phase } from "@genzed/shared";

export type LobbyPlayer = {
  name: string;
  ready: boolean;
  joinedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  lastProcessedInput: number;
  // @colyseus/schema 2.x instance callback — callable, returns a detach fn
  // (cast at the call site like the existing players.onAdd usage).
  onChange: (cb: () => void) => unknown;
};

export type LobbyPlayers = {
  size: number;
  forEach(cb: (player: LobbyPlayer, sessionId: string) => void): void;
  get(sessionId: string): LobbyPlayer | undefined;
  values(): IterableIterator<LobbyPlayer>;
  keys(): IterableIterator<string>;
  onAdd: (cb: (player: LobbyPlayer, sessionId: string) => void) => void;
  onRemove: (cb: (player: LobbyPlayer, sessionId: string) => void) => void;
};

export type ArenaState = {
  phase: Phase;
  countdownMs: number;
  players: LobbyPlayers;
};
