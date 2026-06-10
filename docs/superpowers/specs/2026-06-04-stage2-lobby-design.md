# Stage 2 — Lobby + Room Lifecycle Design

**Date:** 2026-06-04
**Status:** Approved (sections 1–3)
**Author:** Charlie Shi
**Predecessor:** [Stage 1 foundation](../specs/2026-05-25-genzed-modernization-design.md) (shipped, live at https://genzed.fly.dev)

## Context

Stage 1 shipped a deployable hello-world: a Phaser canvas mounted inside a React shell, connected to a Colyseus `ArenaRoom`, rendering `connected: <sessionId>`. The room only tracks player names in a schema map — there is no lobby UI, no concept of game phase, and no transition into a "playing" state.

Stage 2 builds the lobby and the room state machine that ferries clients between `lobby` and `playing`, preserving the 2017 game's social model (single global lobby, max 4 players, min 2 to start, anyone can click Start). It also introduces real React UI for the first time (name entry, player list, start button, countdown overlay) and Tailwind as the styling approach.

By the end of Stage 2 a human can open two browsers, type names, see each other in the lobby, click Start in one, watch a 3-2-1 countdown, and land in a placeholder Phaser arena scene that names everyone connected. Stage 3 fills the arena with real movement and rendering.

## Goals

- Single global `ArenaRoom`, max 4 players, min 2 to start.
- Three-phase server state machine: `lobby → starting → playing → lobby`.
- Reconnection grace period of 10 seconds (handles refresh and brief network drops).
- React-driven lobby UI (name entry, player list, start button), styled with Tailwind.
- Phaser scene swap from React: lobby phase = no canvas; playing phase = `ArenaScene` placeholder.
- Server is the source of truth for `phase`, `players`, and `countdownMs`. The client never optimistically mutates these.

## Non-goals (Stage 2)

- Chat
- Spectator mode for in-progress games
- Real gameplay (movement, weapons, zombies) — `ArenaScene` is a placeholder
- Win conditions or any real `end_game` trigger (we expose a dev-only hook for testing the transition; real triggers are Stage 4 work)
- Spawn positions / map loading (Stage 3)
- Multiple concurrent rooms (Colyseus' `joinOrCreate` would naturally create a second room if the first is full, but we don't exercise that until Stage 3+)
- Persistent leaderboards / accounts / DB
- Mobile or touch controls

## Architectural decision: single room with `phase` FSM

The room object lives across game cycles. State carries a `phase` enum; transitions are driven by message handlers and a single server-side timer. Considered alternatives:

- **Two-room model** (`LobbyRoom` + `ArenaRoom`, migrate clients at start). Cleaner separation but doesn't fit the single-room legacy model, and forces clients to leave/rejoin awkwardly.
- **Separate `lobbyFSM.ts` module**. Premature abstraction for three states.

The chosen approach is the smallest viable architecture for the gameplay we're preserving.

## Server changes

### Schema

```ts
// server/src/schema/ArenaState.ts
import { Schema, MapSchema, type } from "@colyseus/schema";

export type Phase = "lobby" | "starting" | "playing";

export class Player extends Schema {
  @type("string") name = "";
  @type("boolean") ready = false;       // unused in host-starts mode but cheap to carry
  @type("number") joinedAt = 0;
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}
```

### `ArenaRoom` lifecycle

```ts
class ArenaRoom extends Room<ArenaState> {
  override maxClients = 4;
  static readonly RECONNECT_SECONDS = 10;
  static readonly COUNTDOWN_MS = 3000;
  static readonly COUNTDOWN_TICK_MS = 100;

  override onCreate(): void { ... }
  override onAuth(client, options): boolean { ... }   // gates join by phase
  override onJoin(client, options): void { ... }
  override onLeave(client, consented): Promise<void> { ... }  // grace period
  override onMessage("start_game"): void { ... }
  override onMessage("end_game"): void { ... }        // dev hook
}
```

### Transitions

- **Join (`onAuth` + `onJoin`)**
  - Reject with `ServerError(CODE_GAME_IN_PROGRESS = 4001, "game in progress")` if `state.phase !== "lobby"`.
  - Reject with `ServerError(CODE_LOBBY_FULL = 4003, "lobby full")` if `state.players.size >= 4`.
  - Otherwise add a `Player { name, ready: false, joinedAt: Date.now() }` keyed by `client.sessionId`.

- **Leave (`onLeave(client, consented)`)**
  - If `consented` (client called `room.leave()` explicitly), remove the player immediately.
  - Otherwise call `this.allowReconnection(client, RECONNECT_SECONDS)`. On resolved promise: nothing to restore (player still in state, sessionId is preserved by Colyseus). On rejected promise: delete from `state.players`.

- **`start_game` message**
  - No-op unless `state.phase === "lobby"` and `state.players.size >= 2`. (Server enforces; client UI also disables the button, but server is the gate.)
  - Set `state.phase = "starting"` and `state.countdownMs = COUNTDOWN_MS`.
  - Start a `setSimulationInterval(COUNTDOWN_TICK_MS)` callback that decrements `state.countdownMs` by `COUNTDOWN_TICK_MS`. When it hits 0: set `state.phase = "playing"`, clear `countdownMs = 0`, and clear the interval.

- **`end_game` message** (dev hook, gated; production trigger comes in Stage 4)
  - No-op unless `state.phase === "playing"`.
  - Set `state.phase = "lobby"`, reset `countdownMs = 0`, clear every player's `ready = false`. Players keep their sessions and names.

### Patch rate

Default Colyseus 20 Hz, which already aligns with `TICK_HZ` from `shared/src/constants.ts`. The countdown ticks at 100 ms server-side; clients render whatever value most-recently arrived via patch.

### Server tests (Vitest + `@colyseus/testing`)

1. New room starts with `phase === "lobby"`.
2. One client cannot start: `room.send("start_game")` → `phase` stays `"lobby"`.
3. Two clients → `start_game` → observe `"starting"` → after ~3 s observe `"playing"`.
4. Join while `phase === "playing"` is rejected with code 4001.
5. Join while `players.size === 4` is rejected with code 4003.
6. Client disconnect (unconsented) → reconnect within 10 s → slot retained (player still in `state.players`).
7. Client disconnect (unconsented) → no reconnect → after ~10 s player removed.
8. `end_game` while `phase === "playing"` returns room to `phase === "lobby"` and clears `countdownMs`.

## Client changes

### Connection hook

`client/src/lobby/useArenaRoom.ts` owns the singleton `Room` instance.

Exposes:

```ts
type ArenaRoomHook = {
  status: "idle" | "joining" | "joined" | "reconnecting" | "error";
  phase: Phase | null;
  countdownMs: number;
  players: Map<string, { sessionId: string; name: string }>;
  sessionId: string | null;
  error: { code: number; message: string } | null;
  join(name: string): Promise<void>;
  leave(): void;
  start(): void;
};
```

Internals:
- Uses the existing `connectArena` helper, augmented to accept `name`.
- Subscribes to `room.onStateChange` and increments an internal version counter so React re-renders. Colyseus schemas mutate in place; identity-based change detection does not fire.
- On `room.onLeave(code)` from the server, parks in `status: "reconnecting"` and calls `client.reconnect(reconnectionToken)` until success or the 10 s grace expires. Then falls back to `status: "idle"` and surfaces the error.
- On `room.onError`, populates `error` with `{ code, message }`. The hook does not auto-retry on join errors (e.g. 4001/4003) — the user clicks Try Again.

`RoomContext` is a thin `React.createContext<ArenaRoomHook | null>` so both lobby views and the Phaser mount read the same instance.

### View routing

No `react-router`. `App.tsx` selects a view based on `status`, `phase`, and `sessionId`:

| Condition | View |
| --- | --- |
| `status === "idle"` (no room) | `<NameEntry />` |
| `status === "joining"` | `<NameEntry />` with disabled input + spinner |
| `status === "joined"` and `phase === "lobby"` | `<Lobby />` |
| `status === "joined"` and `phase === "starting"` | `<Lobby />` with `<CountdownOverlay />` |
| `status === "joined"` and `phase === "playing"` | `<GameMount />` |
| `status === "reconnecting"` | `<ReconnectingBanner />` over the last good view |
| `status === "error"` | `<NameEntry />` with error message |

### Components

- **`NameEntry`** — One text input (max 20 chars, trimmed), one Join button. Shows `error.message` when present. Disabled while `status === "joining"`.
- **`Lobby`** — Header (genzed logo + your name + session id), player list (live from `state.players`), Start Game button (disabled when `players.size < 2`), Leave Lobby button. Start button click → `start()`. Leave button click → `leave()`.
- **`CountdownOverlay`** — Full-screen-ish overlay with `Math.ceil(countdownMs / 1000)` displayed huge. Pure read-from-state, no internal timer.
- **`ReconnectingBanner`** — A toast/banner showing "Reconnecting… (Xs left)" with a fallback "Give up" button that calls `leave()` and parks the user in `NameEntry`.

### Phaser scene swap

- `HelloScene` renamed `ArenaScene`. Takes `{ room: Room<ArenaState> }` via `scene.start("arena", { room })`.
- `ArenaScene.create({ room })` renders one text line per player: `"<name> (you)"` for the local sessionId, `"<name>"` otherwise. Listens to `state.players.onAdd`/`onRemove` and updates labels. Subscribes to `state.phase`; when it drops back to `"lobby"`, calls `this.scene.stop()` and reports up so React unmounts.
- `GameMount` (existing) only mounts Phaser when `phase === "playing"`. When `phase` leaves `"playing"`, destroys the Phaser game. Re-mounts cleanly on next game.

### Styling: Tailwind

- Add `tailwindcss@3`, `postcss`, `autoprefixer` as client devDeps.
- `client/tailwind.config.cjs` content globs: `./index.html`, `./src/**/*.{ts,tsx}`.
- `client/postcss.config.cjs` standard tailwind + autoprefixer setup.
- `client/src/index.css`: three `@tailwind` directives plus minimal globals (body bg, default font).
- `main.tsx` imports `./index.css`.
- `index.html` inline `<style>` block and the hard-coded `#game` element are removed; the Phaser container is sized by the React component now.

### Client tests

The lobby hook is exercised end-to-end through the Playwright smoke test. No dedicated unit tests for the hook in Stage 2 — its behavior is observable from the rendered DOM and we have no need for component-level isolation yet (Prototype tier: happy path only).

## Wire protocol (shared)

`shared/src/messages.ts` (new):

```ts
export const MSG_START_GAME = "start_game";
export const MSG_END_GAME = "end_game";

export const CODE_GAME_IN_PROGRESS = 4001;
export const CODE_LOBBY_FULL = 4003;
```

Messages carry no payload. Constants live in `shared` so server and client cannot drift.

## File map

```
shared/src/
  messages.ts                          [NEW]
  index.ts                             [MODIFIED] export messages
server/src/
  schema/ArenaState.ts                 [MODIFIED] phase, countdownMs, Player.ready/joinedAt
  rooms/ArenaRoom.ts                   [MODIFIED] FSM + handlers + reconnection
  __tests__/arenaRoom.test.ts          [MODIFIED] 8 tests covering transitions
client/
  package.json                         [MODIFIED] add tailwind deps
  tailwind.config.cjs                  [NEW]
  postcss.config.cjs                   [NEW]
  index.html                           [MODIFIED] drop inline <style>
  src/
    index.css                          [NEW] @tailwind directives + minimal globals
    main.tsx                           [MODIFIED] import ./index.css
    App.tsx                            [MODIFIED] view switcher
    lobby/
      useArenaRoom.ts                  [NEW]
      RoomContext.tsx                  [NEW]
      NameEntry.tsx                    [NEW]
      Lobby.tsx                        [NEW]
      CountdownOverlay.tsx             [NEW]
      ReconnectingBanner.tsx           [NEW]
    game/
      GameMount.tsx                    [MODIFIED] mount on phase === "playing"
      net/connect.ts                   [MODIFIED] accept name, return room+reconnectionToken
      scenes/
        ArenaScene.ts                  [RENAME from HelloScene.ts] reads room state
tests/
  smoke.spec.ts                        [MODIFIED] two-context smoke covering join → start → playing
docs/
  stage2-evidence/                     [NEW] verification screenshots
  superpowers/specs/2026-06-04-stage2-lobby-design.md   [NEW] this file
```

## Verification gate (Stage 2 done criteria)

All must pass before merging to master:

| Check | Result expected |
| --- | --- |
| `pnpm typecheck` | clean across all packages |
| `pnpm lint` | clean |
| `pnpm test` | all server tests pass (8 expected) |
| `pnpm test:e2e` | Playwright smoke green (two contexts → join → start → playing) |
| Local `pnpm dev` two-browser session | both join, host starts, both see countdown then "GAME ON — 2 players" |
| `docker build` + `docker run` | same |
| Live Fly deploy | same on https://genzed.fly.dev |

Screenshots from each step land in `docs/stage2-evidence/`.

## Known sharp edges for Stage 3

- **`ArenaScene` is a placeholder.** Stage 3 replaces text labels with real Phaser sprites and a Tiled tilemap.
- **Player slots are not stable across games.** Each game starts from the same `players` map; if Stage 4 needs per-game stats (kills, deaths), those will need to be separate maps that reset on `end_game`.
- **Real `end_game` trigger isn't wired.** The dev message handler exists for testing the transition; Stage 4 wires it to win conditions.
- **No spawn positions.** `ArenaScene` doesn't place players anywhere meaningful — Stage 3 introduces server-chosen spawn coordinates.
- **`min_machines_running = 0`.** Once Stage 2 lands, a sleeping machine still drops mid-game state. Bump to 1 if/when we care; currently we don't.

## Open questions (deferred, not blocking)

- Should the host be marked visually in the lobby (e.g. crown next to first-joined)? The design treats every player equally as "host" for now.
- Lobby chat as a fast-follow after Stage 2 lands? Out of scope right now; revisit after Stage 3.
- Tailwind theme/colors — accept defaults for Stage 2, refine in Stage 5 polish.
