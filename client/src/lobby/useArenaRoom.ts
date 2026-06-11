import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import { MSG_START_GAME, MSG_END_GAME, type Phase } from "@genzed/shared";
import {
  joinArena,
  reconnectArena,
  type ConnectedRoom,
} from "../game/net/connect.js";
import type { ArenaState, LobbyPlayer } from "./arenaState.js";

type Status = "idle" | "joining" | "joined" | "reconnecting" | "error";

type RoomError = { code: number; message: string };

export type ArenaRoomHook = {
  status: Status;
  phase: Phase | null;
  countdownMs: number;
  players: Map<string, LobbyPlayer>;
  sessionId: string | null;
  reconnectSecondsLeft: number;
  /** Bumps every time attach() binds a (re)connected room — keys GameMount so
   * a reconnect remounts Phaser onto the fresh room instead of the dead socket. */
  roomEpoch: number;
  error: RoomError | null;
  getRoom(): Room<ArenaState> | null;
  join(name: string): Promise<void>;
  leave(): void;
  start(): void;
  endGame(): void;
  giveUpReconnect(): void;
};

const RECONNECT_WINDOW_MS = 10_000;

export function useArenaRoom(): ArenaRoomHook {
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState<Phase | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [players, setPlayers] = useState<Map<string, LobbyPlayer>>(new Map());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [reconnectSecondsLeft, setReconnectSecondsLeft] = useState(0);
  const [roomEpoch, setRoomEpoch] = useState(0);

  const roomRef = useRef<Room<ArenaState> | null>(null);
  const reconnectTokenRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectStartedAtRef = useRef<number>(0);

  const detach = useCallback(() => {
    roomRef.current = null;
    reconnectTokenRef.current = null;
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setPhase(null);
    setCountdownMs(0);
    setPlayers(new Map());
    setSessionId(null);
  }, []);

  const attach = useCallback((connected: ConnectedRoom) => {
    const { room, reconnectionToken } = connected;
    roomRef.current = room;
    reconnectTokenRef.current = reconnectionToken;
    setRoomEpoch((e) => e + 1);
    setSessionId(room.sessionId);
    setStatus("joined");
    setError(null);

    const sync = (): void => {
      setPhase(room.state.phase);
      setCountdownMs(room.state.countdownMs);
      const next = new Map<string, LobbyPlayer>();
      room.state.players.forEach((p, id) => {
        next.set(id, p);
      });
      setPlayers(next);
    };

    sync();
    // Targeted listeners instead of onStateChange: bullet/position churn patches
    // 20×/s once combat ships — React must only re-render on lobby-relevant
    // changes (phase, countdown, membership). HUD reads schema inside Phaser.
    room.state.listen("phase", sync);
    room.state.listen("countdownMs", sync);
    room.state.players.onAdd(sync);
    room.state.players.onRemove(sync);
    room.onError((code, message) => {
      setError({ code, message: message ?? "room error" });
    });
    room.onLeave((code) => {
      // 4000 = Colyseus consented close (client called room.leave()); anything else = unexpected.
      if (code === 4000) {
        detach();
        setStatus("idle");
        return;
      }
      // Enter reconnecting flow.
      const token = reconnectTokenRef.current;
      if (!token) {
        detach();
        setStatus("idle");
        return;
      }
      setStatus("reconnecting");
      reconnectStartedAtRef.current = Date.now();
      setReconnectSecondsLeft(Math.ceil(RECONNECT_WINDOW_MS / 1000));
      reconnectTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - reconnectStartedAtRef.current;
        const left = Math.max(0, RECONNECT_WINDOW_MS - elapsed);
        setReconnectSecondsLeft(Math.ceil(left / 1000));
        if (left <= 0) {
          if (reconnectTimerRef.current) {
            clearInterval(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          detach();
          setStatus("error");
          setError({ code: 0, message: "reconnect timeout" });
        }
      }, 250);

      void (async () => {
        try {
          const reconnected = await reconnectArena(token);
          if (reconnectTimerRef.current) {
            clearInterval(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          attach(reconnected);
        } catch (err) {
          // Let the interval finish; final state handled in interval.
          if (reconnectTimerRef.current) {
            // No-op: interval will reach zero and detach.
          }
          // Swallow — the interval drives final state.
          void err;
        }
      })();
    });
  }, [detach]);

  const join = useCallback(async (name: string) => {
    setError(null);
    setStatus("joining");
    try {
      const connected = await joinArena(name);
      attach(connected);
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      setError({ code: e.code ?? 0, message: e.message ?? "join failed" });
      setStatus("error");
    }
  }, [attach]);

  const leave = useCallback(() => {
    const room = roomRef.current;
    if (room) room.leave(true);
    detach();
    setStatus("idle");
  }, [detach]);

  const start = useCallback(() => {
    roomRef.current?.send(MSG_START_GAME);
  }, []);

  const endGame = useCallback(() => {
    roomRef.current?.send(MSG_END_GAME);
  }, []);

  const giveUpReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    detach();
    setStatus("idle");
  }, [detach]);

  // Stable identity — GameMount's effect depends on this; a fresh closure per
  // render would tear down and recreate the Phaser game on every state patch.
  const getRoom = useCallback(() => roomRef.current, []);

  useEffect(() => () => {
    if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current);
    roomRef.current?.leave(true);
  }, []);

  return {
    status,
    phase,
    countdownMs,
    players,
    sessionId,
    error,
    reconnectSecondsLeft,
    roomEpoch,
    getRoom,
    join,
    leave,
    start,
    endGame,
    giveUpReconnect,
  };
}
