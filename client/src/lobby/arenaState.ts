import type { Phase } from "@genzed/shared";

export type LobbyPlayer = {
  name: string;
  ready: boolean;
  joinedAt: number;
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
