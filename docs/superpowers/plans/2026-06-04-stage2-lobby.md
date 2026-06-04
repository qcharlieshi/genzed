# Stage 2 — Lobby + Room Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Stage 1 hello-world into a working lobby: name entry, live player list, host-starts countdown, scene swap into a placeholder Phaser `ArenaScene` that names everyone connected. Server-authoritative phase FSM (`lobby → starting → playing → lobby`) with 10s reconnection grace.

**Architecture:** Extend the existing `ArenaRoom` with a phase state machine and message handlers. React owns lobby UI (Tailwind), subscribes to room state via a hook, and conditionally mounts Phaser only during the `playing` phase. Server is the single source of truth for `phase`, `players`, and `countdownMs`.

**Tech Stack:** Node 20, Colyseus 0.15, @colyseus/schema 2.0, TypeScript 5.5, Vitest, React 18, Vite 5, Tailwind CSS 3, Phaser 3.80, Playwright.

---

## Reference: spec

`docs/superpowers/specs/2026-06-04-stage2-lobby-design.md`. Read it before starting. The spec defines the view-state table, the FSM transitions, the wire-protocol constants, and the verification gate.

## Conventions for all tasks

- All commands run from repo root (`/Users/qcharlieshi/dev/genzed`) unless noted.
- Branch: `stage-2-lobby` (already exists from spec commit).
- Conventional commit prefixes: `feat:`, `chore:`, `test:`, `docs:`, `refactor:`, `build:`.
- Run `pnpm typecheck` and `pnpm exec eslint <package>/` before each commit.
- Never use `--no-verify` on commits.
- Never push to remote — branch lives locally and via PR.

## File map (what this stage touches)

```
shared/src/
  messages.ts                       [NEW]
  index.ts                          [MODIFIED] re-export
server/src/
  schema/ArenaState.ts              [REWRITE] add phase/countdownMs/Player.ready/joinedAt
  rooms/ArenaRoom.ts                [REWRITE] phase FSM + handlers + reconnection
  __tests__/arenaRoom.test.ts       [REWRITE] 8 transition tests
client/
  package.json                      [MODIFIED] tailwind devDeps
  tailwind.config.cjs               [NEW]
  postcss.config.cjs                [NEW]
  index.html                        [MODIFIED] drop inline <style>
  src/
    index.css                       [NEW] @tailwind + minimal globals
    main.tsx                        [MODIFIED] import index.css
    App.tsx                         [REWRITE] view switcher
    lobby/
      useArenaRoom.ts               [NEW]
      RoomContext.tsx               [NEW]
      NameEntry.tsx                 [NEW]
      Lobby.tsx                     [NEW]
      CountdownOverlay.tsx          [NEW]
      ReconnectingBanner.tsx        [NEW]
    game/
      GameMount.tsx                 [REWRITE] mount on phase==="playing"
      net/connect.ts                [MODIFIED] return ConnectedRoom { room, reconnectionToken }
      scenes/
        ArenaScene.ts               [NEW, replaces HelloScene]
        HelloScene.ts               [DELETE]
tests/
  smoke.spec.ts                     [REWRITE] two-context lobby → start → playing
docs/
  stage2-evidence/                  [NEW directory] verification screenshots (added in Task 14)
```

---

## Task 1: Shared wire protocol constants

**Files:**
- Create: `shared/src/messages.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write `shared/src/messages.ts`**

```ts
export const MSG_START_GAME = "start_game";
export const MSG_END_GAME = "end_game";

export const CODE_GAME_IN_PROGRESS = 4001;
export const CODE_LOBBY_FULL = 4003;

export type Phase = "lobby" | "starting" | "playing";
```

- [ ] **Step 2: Modify `shared/src/index.ts`**

```ts
export * from "./constants.js";
export * from "./messages.js";
```

- [ ] **Step 3: Build + typecheck**

Run: `pnpm --filter @genzed/shared build && pnpm --filter @genzed/shared typecheck`
Expected: both exit 0. `shared/dist/messages.js` and `shared/dist/messages.d.ts` exist.

- [ ] **Step 4: Commit**

```bash
git add shared/src/messages.ts shared/src/index.ts
git commit -m "feat(shared): add lobby wire protocol constants and Phase type"
```

---

## Task 2: Server schema — add phase, countdown, player fields

**Files:**
- Modify: `server/src/schema/ArenaState.ts`

- [ ] **Step 1: Rewrite `server/src/schema/ArenaState.ts`**

```ts
import { Schema, MapSchema, type } from "@colyseus/schema";
import type { Phase } from "@genzed/shared";

export class Player extends Schema {
  @type("string") name = "";
  @type("boolean") ready = false;
  @type("number") joinedAt = 0;
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @genzed/server typecheck`
Expected: exit 0. (The existing `ArenaRoom.ts` still uses `Player` constructor and `name` — both still present.)

- [ ] **Step 3: Commit**

```bash
git add server/src/schema/ArenaState.ts
git commit -m "feat(server): extend ArenaState with phase, countdownMs, player metadata"
```

---

## Task 3: Server room FSM — failing tests first

**Files:**
- Modify: `server/src/__tests__/arenaRoom.test.ts`

- [ ] **Step 1: Rewrite the test file with the full Stage 2 suite**

Replace the entire contents of `server/src/__tests__/arenaRoom.test.ts` with:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";
import { type ArenaState } from "../schema/ArenaState.js";
import {
  MSG_START_GAME,
  MSG_END_GAME,
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
} from "@genzed/shared";

let colyseus: ColyseusTestServer;

async function bootOnce(): Promise<ColyseusTestServer> {
  colyseus = await boot(appConfig);
  return colyseus;
}

afterEach(async () => {
  await colyseus?.shutdown();
});

describe("ArenaRoom — initial state", () => {
  it("starts in lobby phase with no players", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.size).toBe(0);
    expect(room.state.countdownMs).toBe(0);
  });
});

describe("ArenaRoom — join", () => {
  it("accepts a client joining with a name", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const client = await cs.connectTo(room, { name: "alice" });
    await client.waitForNextPatch();
    expect(room.state.players.size).toBe(1);
    const player = room.state.players.get(client.sessionId);
    if (!player) throw new Error("player not found");
    expect(player.name).toBe("alice");
    expect(player.ready).toBe(false);
    expect(player.joinedAt).toBeGreaterThan(0);
  });

  it("rejects joining when the lobby is full (4 players)", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    await cs.connectTo(room, { name: "c" });
    await cs.connectTo(room, { name: "d" });
    await expect(cs.connectTo(room, { name: "e" })).rejects.toMatchObject({
      code: CODE_LOBBY_FULL,
    });
  });
});

describe("ArenaRoom — start_game", () => {
  it("is a no-op with one player", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "solo" });
    c1.send(MSG_START_GAME);
    await c1.waitForNextPatch().catch(() => {});
    // Phase did not change.
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownMs).toBe(0);
  });

  it("transitions lobby → starting → playing with two players", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const c2 = await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    // Wait until phase becomes "starting" (within a tick or two).
    await c2.waitForMessage("__irrelevant__").catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    expect(room.state.phase).toBe("starting");
    expect(room.state.countdownMs).toBeGreaterThan(0);
    // Wait long enough for the 3s countdown to complete.
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    expect(room.state.countdownMs).toBe(0);
  });
});

describe("ArenaRoom — join while playing", () => {
  it("rejects with code 4001", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    // Wait through countdown.
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    await expect(cs.connectTo(room, { name: "late" })).rejects.toMatchObject({
      code: CODE_GAME_IN_PROGRESS,
    });
  });
});

describe("ArenaRoom — end_game (dev hook)", () => {
  it("returns to lobby and resets countdownMs", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    await cs.connectTo(room, { name: "b" });
    c1.send(MSG_START_GAME);
    await new Promise((r) => setTimeout(r, 3300));
    expect(room.state.phase).toBe("playing");
    c1.send(MSG_END_GAME);
    await new Promise((r) => setTimeout(r, 100));
    expect(room.state.phase).toBe("lobby");
    expect(room.state.countdownMs).toBe(0);
    // Players retained.
    expect(room.state.players.size).toBe(2);
  });
});

describe("ArenaRoom — reconnection", () => {
  it("retains the slot if the client reconnects within the grace period", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const sessionId = c1.sessionId;
    const reconnectionToken = c1.reconnectionToken;
    // Simulate ungraceful disconnect.
    c1.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    // Player still in state during grace.
    expect(room.state.players.has(sessionId)).toBe(true);
    // Reconnect using the token.
    const c1again = await cs.sdk.reconnect(reconnectionToken);
    await c1again.waitForNextPatch();
    expect(room.state.players.has(c1again.sessionId)).toBe(true);
    expect(c1again.sessionId).toBe(sessionId);
  });

  it("removes the player when reconnection grace expires", async () => {
    const cs = await bootOnce();
    const room = await cs.createRoom<ArenaState>("arena", {});
    const c1 = await cs.connectTo(room, { name: "a" });
    const sessionId = c1.sessionId;
    c1.leave(false);
    // RECONNECT_SECONDS = 10 in the room; wait 11s.
    await new Promise((r) => setTimeout(r, 11_000));
    expect(room.state.players.has(sessionId)).toBe(false);
  }, 15_000);
});
```

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @genzed/server test`
Expected: multiple FAILures referring to `phase`, `countdownMs`, `CODE_GAME_IN_PROGRESS`, etc. The existing `ArenaRoom` doesn't implement the FSM yet.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/arenaRoom.test.ts
git commit -m "test(server): add failing FSM + reconnection tests for ArenaRoom"
```

---

## Task 4: Server room FSM — implementation

**Files:**
- Modify: `server/src/rooms/ArenaRoom.ts`

- [ ] **Step 1: Rewrite `server/src/rooms/ArenaRoom.ts`**

```ts
import { Room, ServerError, type Client } from "@colyseus/core";
import {
  CODE_GAME_IN_PROGRESS,
  CODE_LOBBY_FULL,
  MSG_END_GAME,
  MSG_START_GAME,
} from "@genzed/shared";
import { ArenaState, Player } from "../schema/ArenaState.js";

const MAX_CLIENTS = 4;
const MIN_TO_START = 2;
const COUNTDOWN_MS = 3000;
const COUNTDOWN_TICK_MS = 100;
const RECONNECT_SECONDS = 10;

export class ArenaRoom extends Room<ArenaState> {
  override maxClients = MAX_CLIENTS;

  private countdownInterval: NodeJS.Timeout | null = null;

  override onCreate(): void {
    this.setState(new ArenaState());
    this.onMessage(MSG_START_GAME, (client) => this.handleStartGame(client));
    this.onMessage(MSG_END_GAME, (client) => this.handleEndGame(client));
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
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    if (consented) {
      this.state.players.delete(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      // reconnected — nothing to do, sessionId preserved.
    } catch {
      this.state.players.delete(client.sessionId);
    }
  }

  override onDispose(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private handleStartGame(_client: Client): void {
    if (this.state.phase !== "lobby") return;
    if (this.state.players.size < MIN_TO_START) return;
    this.state.phase = "starting";
    this.state.countdownMs = COUNTDOWN_MS;
    this.countdownInterval = setInterval(() => {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - COUNTDOWN_TICK_MS);
      if (this.state.countdownMs <= 0) {
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
    this.state.players.forEach((player) => {
      player.ready = false;
    });
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @genzed/server typecheck && pnpm exec eslint server/`
Expected: both exit 0.

- [ ] **Step 3: Run tests — expect all passing**

Run: `pnpm --filter @genzed/server test`
Expected: 8 tests PASS across 5 describe blocks. Test runtime ~15s (the grace-expiration test waits 11s).

If any test fails, fix the room until they all pass. Do not edit the tests (the test code is the spec).

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/ArenaRoom.ts
git commit -m "feat(server): implement ArenaRoom phase FSM and reconnection grace"
```

---

## Task 5: Tailwind setup

**Files:**
- Modify: `client/package.json`
- Create: `client/tailwind.config.cjs`
- Create: `client/postcss.config.cjs`
- Create: `client/src/index.css`
- Modify: `client/index.html`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Add tailwind deps to `client/package.json`**

In `devDependencies`, add (alphabetical order with existing entries):

```json
"autoprefixer": "10.4.20",
"postcss": "8.4.41",
"tailwindcss": "3.4.10"
```

Run: `pnpm install`
Expected: three new deps resolve and install.

- [ ] **Step 2: Write `client/tailwind.config.cjs`**

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 3: Write `client/postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Write `client/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
}

body {
  background-color: #111;
  color: #eee;
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 5: Modify `client/index.html` to drop the inline `<style>` block and `#game` styling**

Replace the entire file with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Genzed</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Modify `client/src/main.tsx` to import `index.css`**

Replace the entire file with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @genzed/client typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add client/package.json client/tailwind.config.cjs client/postcss.config.cjs client/src/index.css client/index.html client/src/main.tsx pnpm-lock.yaml
git commit -m "build(client): add Tailwind CSS and tidy up index.html"
```

---

## Task 6: Update `connect.ts` to return room + reconnection token

**Files:**
- Modify: `client/src/game/net/connect.ts`

- [ ] **Step 1: Rewrite `client/src/game/net/connect.ts`**

```ts
import { Client, type Room } from "colyseus.js";
import { COLYSEUS_PATH, ROOM_NAME } from "@genzed/shared";
import type { ArenaState } from "../../lobby/arenaState.js";

const wsProto = (): "wss:" | "ws:" =>
  window.location.protocol === "https:" ? "wss:" : "ws:";

const endpoint = (): string =>
  `${wsProto()}//${window.location.host}${COLYSEUS_PATH}`;

export type ConnectedRoom = {
  room: Room<ArenaState>;
  reconnectionToken: string;
};

export async function joinArena(name: string): Promise<ConnectedRoom> {
  const client = new Client(endpoint());
  const room = await client.joinOrCreate<ArenaState>(ROOM_NAME, { name });
  return { room, reconnectionToken: room.reconnectionToken };
}

export async function reconnectArena(reconnectionToken: string): Promise<ConnectedRoom> {
  const client = new Client(endpoint());
  const room = await client.reconnect<ArenaState>(reconnectionToken);
  return { room, reconnectionToken: room.reconnectionToken };
}
```

The import of `ArenaState` from `../../lobby/arenaState.js` will fail until Task 7 — that's fine, we wire it up there.

- [ ] **Step 2: Do NOT typecheck yet** — Task 7 creates `arenaState.ts`. We'll typecheck after that.

- [ ] **Step 3: Commit**

```bash
git add client/src/game/net/connect.ts
git commit -m "refactor(client): split connect into joinArena/reconnectArena returning ConnectedRoom"
```

---

## Task 7: Client schema mirror + RoomContext + useArenaRoom hook

**Files:**
- Create: `client/src/lobby/arenaState.ts`
- Create: `client/src/lobby/RoomContext.tsx`
- Create: `client/src/lobby/useArenaRoom.ts`

The client needs a typed mirror of the server's schema for `Room<ArenaState>` typing. We use a TypeScript type only — the Colyseus client deserializes by structure, not by class — so no `@colyseus/schema` decorators on the client.

- [ ] **Step 1: Write `client/src/lobby/arenaState.ts`**

```ts
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
```

- [ ] **Step 2: Write `client/src/lobby/RoomContext.tsx`**

```tsx
import { createContext, useContext } from "react";
import type { ArenaRoomHook } from "./useArenaRoom.js";

export const RoomContext = createContext<ArenaRoomHook | null>(null);

export function useRoom(): ArenaRoomHook {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside <RoomContext.Provider>");
  return value;
}
```

- [ ] **Step 3: Write `client/src/lobby/useArenaRoom.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import type { Phase } from "@genzed/shared";
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
  error: RoomError | null;
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

  const roomRef = useRef<Room<ArenaState> | null>(null);
  const reconnectTokenRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
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
    setSessionId(room.sessionId);
    setStatus("joined");
    setError(null);

    const sync = (): void => {
      setPhase(room.state.phase);
      setCountdownMs(room.state.countdownMs);
      const next = new Map<string, LobbyPlayer>();
      room.state.players.forEach((p, id) => {
        next.set(id, { name: p.name, ready: p.ready, joinedAt: p.joinedAt });
      });
      setPlayers(next);
    };

    sync();
    room.onStateChange(sync);
    room.onError((code, message) => {
      setError({ code, message: message ?? "room error" });
    });
    room.onLeave((code) => {
      // 1000 = normal close (client-initiated); anything else = unexpected.
      if (code === 1000) {
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
    roomRef.current?.send("start_game");
  }, []);

  const endGame = useCallback(() => {
    roomRef.current?.send("end_game");
  }, []);

  const giveUpReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    detach();
    setStatus("idle");
  }, [detach]);

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
    join,
    leave,
    start,
    endGame,
    giveUpReconnect,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @genzed/client typecheck`
Expected: exit 0. (Task 6's `connect.ts` import is now satisfied.)

- [ ] **Step 5: Lint**

Run: `pnpm exec eslint client/src/lobby/ client/src/game/net/`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/lobby/arenaState.ts client/src/lobby/RoomContext.tsx client/src/lobby/useArenaRoom.ts
git commit -m "feat(client): add ArenaState mirror, RoomContext, useArenaRoom hook"
```

---

## Task 8: NameEntry component

**Files:**
- Create: `client/src/lobby/NameEntry.tsx`

- [ ] **Step 1: Write `client/src/lobby/NameEntry.tsx`**

```tsx
import { useState } from "react";
import { useRoom } from "./RoomContext.js";

export function NameEntry(): JSX.Element {
  const { status, error, join } = useRoom();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const disabled = status === "joining" || trimmed.length === 0 || trimmed.length > 20;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!disabled) void join(trimmed);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-center">Genzed</h1>
        <p className="text-sm text-gray-400 text-center">
          Pick a name to join the lobby.
        </p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="your name"
          className="w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-base text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="player name"
        />
        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white disabled:bg-gray-700 disabled:text-gray-400"
        >
          {status === "joining" ? "Joining…" : "Join Lobby"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {humanizeError(error.code, error.message)}
          </p>
        )}
      </form>
    </div>
  );
}

function humanizeError(code: number, fallback: string): string {
  switch (code) {
    case 4001:
      return "A game is already in progress. Try again in a minute.";
    case 4003:
      return "Lobby is full (4/4).";
    default:
      return fallback;
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @genzed/client typecheck && pnpm exec eslint client/src/lobby/NameEntry.tsx`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/lobby/NameEntry.tsx
git commit -m "feat(client): add NameEntry view with name validation and join action"
```

---

## Task 9: Lobby component + CountdownOverlay + ReconnectingBanner

**Files:**
- Create: `client/src/lobby/Lobby.tsx`
- Create: `client/src/lobby/CountdownOverlay.tsx`
- Create: `client/src/lobby/ReconnectingBanner.tsx`

- [ ] **Step 1: Write `client/src/lobby/Lobby.tsx`**

```tsx
import { useRoom } from "./RoomContext.js";

const MIN_TO_START = 2;
const MAX_PLAYERS = 4;

export function Lobby(): JSX.Element {
  const { players, sessionId, start, leave } = useRoom();
  const list = Array.from(players.entries()).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
  const canStart = list.length >= MIN_TO_START;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Genzed</h1>
          <p className="text-sm text-gray-400">
            {list.length} / {MAX_PLAYERS} players · need {MIN_TO_START} to start
          </p>
        </header>

        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900">
          {list.map(([id, p]) => (
            <li
              key={id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="font-medium text-gray-100">{p.name}</span>
              {id === sessionId && (
                <span className="text-xs uppercase tracking-wide text-emerald-400">
                  you
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium text-white disabled:bg-gray-700 disabled:text-gray-400"
          >
            Start Game
          </button>
          <button
            type="button"
            onClick={leave}
            className="rounded-md border border-gray-700 px-3 py-2 font-medium text-gray-200 hover:bg-gray-900"
          >
            Leave Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/lobby/CountdownOverlay.tsx`**

```tsx
import { useRoom } from "./RoomContext.js";

export function CountdownOverlay(): JSX.Element | null {
  const { phase, countdownMs } = useRoom();
  if (phase !== "starting") return null;
  const seconds = Math.max(0, Math.ceil(countdownMs / 1000));
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="text-8xl font-bold text-white tabular-nums">
        {seconds}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `client/src/lobby/ReconnectingBanner.tsx`**

```tsx
import { useRoom } from "./RoomContext.js";

export function ReconnectingBanner(): JSX.Element {
  const { reconnectSecondsLeft, giveUpReconnect } = useRoom();
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-20 flex items-center justify-between bg-yellow-600 px-4 py-2 text-sm text-white"
    >
      <span>Reconnecting… {reconnectSecondsLeft}s left</span>
      <button
        type="button"
        onClick={giveUpReconnect}
        className="rounded bg-yellow-700 px-2 py-1 text-xs font-medium hover:bg-yellow-800"
      >
        Give up
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @genzed/client typecheck && pnpm exec eslint client/src/lobby/`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/lobby/Lobby.tsx client/src/lobby/CountdownOverlay.tsx client/src/lobby/ReconnectingBanner.tsx
git commit -m "feat(client): add Lobby, CountdownOverlay, ReconnectingBanner views"
```

---

## Task 10: ArenaScene (replaces HelloScene)

**Files:**
- Create: `client/src/game/scenes/ArenaScene.ts`
- Delete: `client/src/game/scenes/HelloScene.ts`

- [ ] **Step 1: Write `client/src/game/scenes/ArenaScene.ts`**

```ts
import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState, LobbyPlayer } from "../../lobby/arenaState.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

export class ArenaScene extends Phaser.Scene {
  private header!: Phaser.GameObjects.Text;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private room!: Room<ArenaState>;
  private localSessionId = "";

  constructor() {
    super("arena");
  }

  create(data: ArenaSceneData): void {
    this.room = data.room;
    this.localSessionId = data.localSessionId;

    this.header = this.add
      .text(400, 40, "GAME ON", {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "28px",
      })
      .setOrigin(0.5);

    this.room.state.players.forEach((p, id) => this.addLabel(id, p));
    this.room.state.players.onAdd((p, id) => this.addLabel(id, p));
    this.room.state.players.onRemove((_p, id) => this.removeLabel(id));

    this.refreshHeader();
  }

  private addLabel(sessionId: string, player: LobbyPlayer): void {
    const y = 100 + this.labels.size * 28;
    const suffix = sessionId === this.localSessionId ? " (you)" : "";
    const label = this.add
      .text(400, y, `${player.name}${suffix}`, {
        color: "#9ae6b4",
        fontFamily: "monospace",
        fontSize: "20px",
      })
      .setOrigin(0.5);
    this.labels.set(sessionId, label);
    this.refreshHeader();
  }

  private removeLabel(sessionId: string): void {
    const label = this.labels.get(sessionId);
    if (label) {
      label.destroy();
      this.labels.delete(sessionId);
    }
    this.relayoutLabels();
    this.refreshHeader();
  }

  private relayoutLabels(): void {
    let i = 0;
    this.labels.forEach((label) => {
      label.setY(100 + i * 28);
      i += 1;
    });
  }

  private refreshHeader(): void {
    const count = this.labels.size;
    this.header.setText(`GAME ON — ${count} player${count === 1 ? "" : "s"}`);
  }
}
```

- [ ] **Step 2: Delete `client/src/game/scenes/HelloScene.ts`**

Run: `rm client/src/game/scenes/HelloScene.ts`

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @genzed/client typecheck && pnpm exec eslint client/src/game/`
Expected: exit 0. (GameMount still imports HelloScene — Task 11 fixes that.)

If typecheck fails on `GameMount.tsx` only because of the missing `HelloScene`, that's expected — proceed to commit.

Actually, since the typecheck WILL fail, hold the commit until after Task 11.

- [ ] **Step 4: Commit (deferred to Task 11 — do not commit yet)**

---

## Task 11: GameMount — mount on phase==="playing" only

**Files:**
- Modify: `client/src/lobby/useArenaRoom.ts`
- Modify: `client/src/game/GameMount.tsx`

`GameMount` needs the live Colyseus `Room` instance to pass into the Phaser scene. The hook owns it in a ref. Expose a `getRoom()` accessor on the hook so `GameMount` can read it without plumbing the room through props.

- [ ] **Step 1: Add `getRoom()` to `useArenaRoom`**

Edit `client/src/lobby/useArenaRoom.ts`. In the `ArenaRoomHook` type, add:

```ts
  getRoom(): Room<ArenaState> | null;
```

In the returned object at the bottom of `useArenaRoom`, add:

```ts
    getRoom: () => roomRef.current,
```

The required `import type { Room } from "colyseus.js";` is already present at the top of the file from Task 7.

- [ ] **Step 2: Rewrite `client/src/game/GameMount.tsx`**

```tsx
import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { useRoom } from "../lobby/RoomContext.js";
import { ArenaScene } from "./scenes/ArenaScene.js";

export function GameMount(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { sessionId, getRoom } = useRoom();

  useEffect(() => {
    if (!containerRef.current) return;
    const room = getRoom();
    if (!room || !sessionId) return;

    const scene = new ArenaScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: "#000000",
      scene: [scene],
    });
    game.scene.start("arena", { room, localSessionId: sessionId });

    return () => {
      game.destroy(true);
    };
  }, [sessionId, getRoom]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div ref={containerRef} className="h-[600px] w-[800px]" />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @genzed/client typecheck && pnpm exec eslint client/`
Expected: exit 0.

- [ ] **Step 4: Commit (this commit absorbs Task 10's deferred changes)**

```bash
git add -A client/src/game/scenes/ client/src/game/GameMount.tsx client/src/lobby/useArenaRoom.ts
git commit -m "feat(client): swap HelloScene for ArenaScene driven by Colyseus state"
```

`git add -A` covers the new `ArenaScene.ts`, the deleted `HelloScene.ts`, and the updated `GameMount.tsx`/`useArenaRoom.ts`.

---

## Task 12: App view switcher

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Rewrite `client/src/App.tsx`**

```tsx
import { useArenaRoom } from "./lobby/useArenaRoom.js";
import { RoomContext } from "./lobby/RoomContext.js";
import { NameEntry } from "./lobby/NameEntry.js";
import { Lobby } from "./lobby/Lobby.js";
import { CountdownOverlay } from "./lobby/CountdownOverlay.js";
import { ReconnectingBanner } from "./lobby/ReconnectingBanner.js";
import { GameMount } from "./game/GameMount.js";

export function App(): JSX.Element {
  const hook = useArenaRoom();

  let view: JSX.Element;
  if (hook.status === "joined" && hook.phase === "playing") {
    view = <GameMount />;
  } else if (hook.status === "joined") {
    view = (
      <>
        <Lobby />
        <CountdownOverlay />
      </>
    );
  } else {
    view = <NameEntry />;
  }

  return (
    <RoomContext.Provider value={hook}>
      {hook.status === "reconnecting" && <ReconnectingBanner />}
      {view}
    </RoomContext.Provider>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @genzed/client typecheck && pnpm exec eslint client/`
Expected: exit 0.

- [ ] **Step 3: Build the client to confirm end-to-end**

Run: `pnpm --filter @genzed/client build`
Expected: Vite build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): wire view switcher based on room status and phase"
```

---

## Task 13: Two-context Playwright smoke

**Files:**
- Modify: `tests/smoke.spec.ts`

- [ ] **Step 1: Rewrite `tests/smoke.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";

async function joinAs(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "player name" }).fill(name);
  await page.getByRole("button", { name: /join lobby/i }).click();
  await expect(page.getByText(`${name}`).first()).toBeVisible({ timeout: 10_000 });
}

test("two players join, host starts, both see the arena", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errors: string[] = [];
  for (const p of [pageA, pageB]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }

  await joinAs(pageA, "alice");
  await joinAs(pageB, "bob");

  // Both pages should see "2 / 4 players" in the lobby.
  await expect(pageA.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await expect(pageB.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });

  // Alice starts the game.
  await pageA.getByRole("button", { name: /start game/i }).click();

  // Both pages should reach the arena canvas within the countdown + small buffer.
  for (const p of [pageA, pageB]) {
    await expect(p.locator("canvas").first()).toBeVisible({ timeout: 8_000 });
  }

  // Allow scenes to settle.
  await pageA.waitForTimeout(500);

  await ctxA.close();
  await ctxB.close();

  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm test:e2e`
Expected: test PASSES. If the playwright config's webServer settings differ from what Stage 1 set up, fix the config so `pnpm test:e2e` runs `pnpm dev` and waits for `http://localhost:5173`.

If the test fails, debug with `pnpm exec playwright test --headed` to see what's actually rendered.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke.spec.ts
git commit -m "test(e2e): smoke covers two-client lobby start and arena swap"
```

---

## Task 14: Local end-to-end verification + screenshots

**Files:**
- Create: `docs/stage2-evidence/` directory (will hold screenshots)

This is human verification, not automated tests.

- [ ] **Step 1: Start dev environment**

Run: `pnpm dev`
Expected: Vite at `http://localhost:5173`, server at `:2567`.

- [ ] **Step 2: Verify lobby in two browser windows**

Open two browser windows (or one normal + one incognito) at `http://localhost:5173`. In each:
1. Type a name. Confirm Start Game button is disabled.
2. After the second player joins, confirm both pages show "2 / 4 players" and the Start Game button enables in both.

Take screenshot: `docs/stage2-evidence/01-lobby-two-players.png` (one window showing the lobby with both names).

- [ ] **Step 3: Verify start + countdown + arena**

Click Start Game in one window. Both windows should:
1. Show the 3-2-1 countdown overlay.
2. Transition to the Phaser arena scene showing "GAME ON — 2 players" and both names.

Take screenshots:
- `docs/stage2-evidence/02-countdown.png` (during countdown, capture either window)
- `docs/stage2-evidence/03-arena.png` (post-countdown arena scene)

- [ ] **Step 4: Verify production build locally**

Stop dev. Run:

```bash
pnpm build
PORT=8080 node server/dist/index.js
```

Open `http://localhost:8080` in two browser contexts. Repeat the join → start → arena flow. Take one screenshot: `docs/stage2-evidence/04-prod-build.png`.

Stop the server with Ctrl-C.

- [ ] **Step 5: Verify the container**

Run:

```bash
docker build -t genzed:local .
docker run --rm -d -p 8080:8080 --name genzed-stage2 genzed:local
```

Repeat the two-context flow at `http://localhost:8080`. Screenshot: `docs/stage2-evidence/05-docker.png`.

Stop: `docker stop genzed-stage2`.

- [ ] **Step 6: Commit screenshots**

```bash
git add docs/stage2-evidence/
git commit -m "docs: add Stage 2 verification screenshots"
```

---

## Task 15: PROGRESS.md + CLAUDE.md update

**Files:**
- Modify: `docs/PROGRESS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/PROGRESS.md`**

In the "Staged delivery" table, update Stage 2 row:

```
| **2. Lobby + room lifecycle** | Name entry, ready states, phase transitions, 2-player minimum, reconnection | ✅ Shipped — live at https://genzed.fly.dev |
```

(Status is set conditionally — only flip to "✅ Shipped" after the PR merges and Fly redeploys. For the branch commit, write: `🟡 In PR — branch `stage-2-lobby`.`)

Use this in the branch commit:

```
| **2. Lobby + room lifecycle** | Name entry, host-starts, phase transitions, 10s reconnection grace, placeholder arena | 🟡 In PR — branch `stage-2-lobby` |
```

Add a new subsection below "Stage 1 — what shipped":

```markdown
## Stage 2 — what shipped

Branch `stage-2-lobby`. Adds:

- Server-authoritative phase FSM (`lobby → starting → playing → lobby`) on `ArenaRoom`.
- `onAuth` gates joins (4001 if playing, 4003 if full).
- 10-second reconnection grace via `allowReconnection`.
- React lobby views (`NameEntry`, `Lobby`, `CountdownOverlay`, `ReconnectingBanner`) styled with Tailwind CSS 3.
- Phaser scene swap: `HelloScene` removed, `ArenaScene` renders one label per player, driven by Colyseus state.
- Two-context Playwright smoke covering the full lobby → start → arena flow.

**Verification:** all eight server FSM tests pass, smoke green, manual two-window flow on dev / prod / docker / Fly — screenshots in `docs/stage2-evidence/`.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the "Staged delivery" section, update the Stage 2 entry from `⬜ Not started` to `✅ Foundation done` (or similar, matching the state the user wants reflected — leave as `⬜` if not yet merged).

In the "Known sharp edges for Stage 2" subsection of CLAUDE.md (if present), replace with "Known sharp edges for Stage 3":

```markdown
## Known sharp edges for Stage 3

- **`ArenaScene` is a placeholder** — Stage 3 replaces text labels with sprites + a Tiled tilemap.
- **No spawn positions** — Stage 3 introduces server-chosen spawn coords.
- **Real `end_game` trigger isn't wired** — Stage 4 wires it to win conditions; for now only the dev message handler exists.
```

- [ ] **Step 3: Commit**

```bash
git add docs/PROGRESS.md CLAUDE.md
git commit -m "docs: mark Stage 2 in-PR in PROGRESS and update sharp edges"
```

---

## Done criteria (Stage 2 verification gate)

All must hold true before the PR is mergeable:

1. `pnpm typecheck` clean.
2. `pnpm lint` clean.
3. `pnpm test` passes 8 server tests.
4. `pnpm test:e2e` smoke green.
5. Manual two-window `pnpm dev` shows join → countdown → arena.
6. `pnpm build && node server/dist/index.js` same.
7. `docker build && docker run` same.
8. After PR merge + `fly deploy`: same on https://genzed.fly.dev.
9. Screenshots committed in `docs/stage2-evidence/`.
10. `docs/PROGRESS.md` and `CLAUDE.md` reflect new state.

## Self-review notes

- **Spec coverage:** every spec section maps to one or more tasks:
  - Schema → Task 2.
  - FSM transitions → Tasks 3–4 (tests + impl).
  - Wire protocol → Task 1.
  - Connection hook → Task 7.
  - Views (`NameEntry`, `Lobby`, `CountdownOverlay`, `ReconnectingBanner`) → Tasks 8–9.
  - Phaser scene swap → Tasks 10–11.
  - Tailwind setup → Task 5.
  - Smoke test → Task 13.
  - Verification gate + docs → Tasks 14–15.
- **Type consistency:** `Phase`, `ArenaState`, `LobbyPlayer`, `ConnectedRoom`, `ArenaRoomHook`, message constants — all named identically across tasks.
- **Sharp edges:**
  - Task 6 deliberately leaves the client in a non-typechecking state until Task 7. Worth flagging — the implementer must not commit Task 6 until they reach Task 7's typecheck.
  - Task 10 deletes `HelloScene.ts` but `GameMount.tsx` still imports it; Task 11 fixes the import. Single commit covers both (per Task 11 Step 5).
  - The reconnect grace test (Task 3, second reconnection test) waits 11 seconds. Vitest needs the per-test timeout (15s) we pass — confirm `vitest.config.ts` doesn't override that with a smaller global timeout. If it does, bump the global to 20s.
