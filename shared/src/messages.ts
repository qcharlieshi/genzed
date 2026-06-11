export const MSG_START_GAME = "start_game";
export const MSG_END_GAME = "end_game";

export const CODE_GAME_IN_PROGRESS = 4001;
export const CODE_LOBBY_FULL = 4003;

export type Phase = "lobby" | "starting" | "playing" | "ended";

export const MSG_INPUT = "input";

export type InputMessage = {
  seq: number; // monotonic per client, starts at 1
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

// --- Stage 4A combat commands (server-gated, bypass the per-tick input cap) ---

export const MSG_FIRE = "fire";
export type FireMessage = { tx: number; ty: number }; // world point; bullets converge on it

export const MSG_RELOAD = "reload";
export const MSG_ACTIVE_RELOAD = "active_reload";

// Dev/test seam, same trust class as MSG_END_GAME (single friends-only lobby).
export const MSG_DEV_TELEPORT = "dev_teleport";
export type DevTeleportMessage = { x: number; y: number };

// --- Stage 4A broadcasts / targeted events ---

export const EVT_SHOT = "shot";
export type ShotEvent = { shooterId: string; level: number; x: number; y: number };

export const EVT_LOG = "log";
export type LogKind = "slain" | "levelup" | "rank" | "win" | "pickup";
export type LogEvent = { kind: LogKind; text: string };

// Sent to the reloading client only (spec addendum: success can't be derived
// from schema without racing normal completion; jam/success need instant FX).
export const EVT_RELOAD_RESULT = "reload_result";
export type ReloadResultEvent = { ok: boolean };
