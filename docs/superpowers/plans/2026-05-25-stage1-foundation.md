# Stage 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new monorepo (pnpm + TypeScript), a Vite/React/Phaser 3 client shell, a Colyseus server shell, a multi-stage Docker build, and a Fly.io deploy + GitHub Actions CI — yielding a publicly-reachable "hello world" where a browser connects to a Colyseus `ArenaRoom` and prints "connected" in the Phaser canvas. Legacy code is preserved under `legacy/` for reference.

**Architecture:** pnpm workspace with three packages (`client/`, `server/`, `shared/`). The Colyseus server (Node 20 + Express) also serves the built client bundle from `client/dist/`. One container, one port, one Fly app. Dev uses Vite (5173) proxying `/colyseus` and `/matchmake` to the Colyseus server (2567).

**Tech Stack:** Node 20, pnpm 9, TypeScript 5, Vite 5, React 18, Phaser 3.80, Colyseus 0.15, Express 4, Vitest, Playwright, Docker, Fly.io, GitHub Actions.

---

## Reference: spec

`docs/superpowers/specs/2026-05-25-genzed-modernization-design.md`. Read it before starting. Sections relevant to this stage: "Repo structure", "Stack", "Build", "Local development", "Deploy", "CI", "Staged delivery → 1. Foundation".

## File map (created in this stage)

- `package.json` — root workspace manifest, scripts (`dev`, `build`, `lint`, `typecheck`, `test`).
- `pnpm-workspace.yaml` — declares `client`, `server`, `shared` packages.
- `pnpm-lock.yaml` — generated.
- `.tool-versions` — `nodejs 20`.
- `.gitignore` — replace existing.
- `.editorconfig`
- `tsconfig.base.json` — shared strict TS config.
- `.eslintrc.cjs`, `.prettierrc`
- `Dockerfile` — multi-stage build.
- `.dockerignore`
- `fly.toml` — Fly app config.
- `.github/workflows/ci.yml`
- `legacy/` — old `client/` and `server/` moved here, untouched.
- `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`, `shared/src/constants.ts`
- `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/rooms/ArenaRoom.ts`, `server/src/__tests__/healthz.test.ts`, `server/src/__tests__/arenaRoom.test.ts`, `server/vitest.config.ts`
- `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/game/GameMount.tsx`, `client/src/game/scenes/HelloScene.ts`
- `tests/smoke.spec.ts` — Playwright smoke test
- `playwright.config.ts`
- `README.md` — rewrite for new structure.
- `docs/superpowers/plans/2026-05-25-stage1-foundation.md` — this file (already exists).

## Conventions for all tasks

- All commands run from repo root (`/Users/qcharlieshi/dev/genzed`) unless noted.
- Conventional commit prefixes: `feat:`, `chore:`, `test:`, `docs:`, `ci:`, `build:`.
- After every task that touches code, run `pnpm typecheck` before committing.
- Never use `--no-verify` on commits.

---

## Task 1: Archive legacy code

**Files:**
- Move: `client/` → `legacy/client/`
- Move: `server/` → `legacy/server/`
- Move: `tests/` → `legacy/tests/`
- Move: `webpack.config.js` → `legacy/webpack.config.js`
- Move: `.babelrc` → `legacy/.babelrc`
- Move: `yarn.lock` → `legacy/yarn.lock`
- Modify: `package.json` (will be replaced in Task 2; for now just move out of the way)
- Move: `package.json` → `legacy/package.json`

- [ ] **Step 1: Move legacy files**

```bash
mkdir -p legacy
git mv client legacy/client
git mv server legacy/server
git mv tests legacy/tests
git mv webpack.config.js legacy/webpack.config.js
git mv .babelrc legacy/.babelrc
git mv yarn.lock legacy/yarn.lock
git mv package.json legacy/package.json
```

- [ ] **Step 2: Verify**

Run: `ls -la && ls legacy/`
Expected: top level shows `legacy/`, `README.md`, `docs/`, `.git/`, `.idea/`, `.gitignore`, `.DS_Store`. `legacy/` contains the old code.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: archive legacy 2017 code under legacy/"
```

---

## Task 2: Root workspace scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.tool-versions`
- Create: `.editorconfig`
- Create: `tsconfig.base.json`
- Replace: `.gitignore`

- [ ] **Step 1: Write `.tool-versions`**

```
nodejs 20.18.0
pnpm 9.12.0
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - client
  - server
  - shared
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "genzed",
  "private": true,
  "version": "0.2.0",
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "pnpm -r --parallel --filter ./client --filter ./server run dev",
    "build": "pnpm -r --filter ./shared --filter ./client --filter ./server run build",
    "typecheck": "pnpm -r run typecheck",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "start": "node server/dist/index.js"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "@types/node": "20.14.10",
    "eslint": "9.9.0",
    "@typescript-eslint/parser": "8.0.0",
    "@typescript-eslint/eslint-plugin": "8.0.0",
    "prettier": "3.3.3"
  }
}
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: Write `.editorconfig`**

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

- [ ] **Step 6: Write `.gitignore` (replace existing)**

```
node_modules
dist
.DS_Store
*.log
.env
.env.local
.vite
coverage
playwright-report
test-results
.fly
```

- [ ] **Step 7: Install pnpm dev deps**

Run: `pnpm install`
Expected: lockfile created, no packages yet beyond root devDeps. No errors.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .tool-versions .editorconfig tsconfig.base.json .gitignore
git commit -m "chore: bootstrap pnpm workspace and root tooling"
```

---

## Task 3: Shared package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `shared/src/constants.ts`

- [ ] **Step 1: Write `shared/package.json`**

```json
{
  "name": "@genzed/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint yet'",
    "test": "echo 'no tests yet'"
  },
  "devDependencies": {
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 2: Write `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "composite": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `shared/src/constants.ts`**

```ts
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const ROOM_NAME = "arena";
export const COLYSEUS_PATH = "/colyseus";
```

- [ ] **Step 4: Write `shared/src/index.ts`**

```ts
export * from "./constants.js";
```

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install && pnpm --filter @genzed/shared typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add shared/ pnpm-lock.yaml
git commit -m "feat(shared): scaffold shared package with tick constants"
```

---

## Task 4: Server package — install deps and write failing /healthz test

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/__tests__/healthz.test.ts`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@genzed/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint yet'",
    "test": "vitest run"
  },
  "dependencies": {
    "@colyseus/core": "0.15.31",
    "@colyseus/schema": "2.0.40",
    "@colyseus/ws-transport": "0.15.20",
    "colyseus": "0.15.31",
    "express": "4.19.2",
    "@genzed/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "tsx": "4.19.0",
    "vitest": "2.0.5",
    "@types/express": "4.17.21",
    "@types/node": "20.14.10",
    "supertest": "7.0.0",
    "@types/supertest": "6.0.2"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 3: Write `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write failing test `server/src/__tests__/healthz.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

describe("GET /healthz", () => {
  it("returns 200 ok", async () => {
    const app = createApp();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });
});
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: server deps installed. No errors.

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm --filter @genzed/server test`
Expected: FAIL — `Cannot find module '../app.js'`.

- [ ] **Step 7: Commit (failing test)**

```bash
git add server/ pnpm-lock.yaml
git commit -m "test(server): add failing healthz test"
```

---

## Task 5: Server package — implement `/healthz` and static serving

**Files:**
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Write `server/src/app.ts`**

```ts
import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // Static client bundle (only present in built container; missing in dev).
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/colyseus") || req.path.startsWith("/matchmake")) {
      return next();
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  return app;
}
```

- [ ] **Step 2: Write `server/src/index.ts`**

```ts
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { COLYSEUS_PATH, ROOM_NAME } from "@genzed/shared";
import { createApp } from "./app.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

const app = createApp();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    path: COLYSEUS_PATH,
  }),
});

gameServer.define(ROOM_NAME, ArenaRoom);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`genzed server listening on :${PORT}`);
});
```

- [ ] **Step 3: Run healthz test, verify it passes**

Run: `pnpm --filter @genzed/server test`
Expected: FAIL — `ArenaRoom` does not exist yet. The test imports `app.ts` but `index.ts` (not under test) imports `ArenaRoom`. Since the test does not import `index.ts`, the healthz test should PASS.

Actual expected: healthz test PASSES. Server `index.ts` won't be exercised yet.

- [ ] **Step 4: Commit**

```bash
git add server/src/app.ts server/src/index.ts
git commit -m "feat(server): implement /healthz and Express+Colyseus shell"
```

---

## Task 6: Server package — `ArenaRoom` minimal + join test

**Files:**
- Create: `server/src/rooms/ArenaRoom.ts`
- Create: `server/src/schema/ArenaState.ts`
- Create: `server/src/__tests__/arenaRoom.test.ts`

- [ ] **Step 1: Write failing test `server/src/__tests__/arenaRoom.test.ts`**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../appConfig.js";

let colyseus: ColyseusTestServer;

describe("ArenaRoom", () => {
  it("accepts a client joining with a name", async () => {
    colyseus = await boot(appConfig);
    const room = await colyseus.createRoom("arena", {});
    const client = await colyseus.connectTo(room, { name: "alice" });
    await client.waitForNextPatch();
    expect(room.state.players.size).toBe(1);
    const player = Array.from(room.state.players.values())[0];
    expect(player.name).toBe("alice");
  });

  afterAll(async () => {
    await colyseus?.shutdown();
  });
});
```

- [ ] **Step 2: Add testing dep**

Edit `server/package.json` `devDependencies` to add:

```json
"@colyseus/testing": "0.15.0"
```

Run: `pnpm install`
Expected: dep installed.

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm --filter @genzed/server test`
Expected: FAIL — `Cannot find module '../appConfig.js'`.

- [ ] **Step 4: Write `server/src/schema/ArenaState.ts`**

```ts
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
```

- [ ] **Step 5: Write `server/src/rooms/ArenaRoom.ts`**

```ts
import { Room, type Client } from "@colyseus/core";
import { ArenaState, Player } from "../schema/ArenaState.js";

export class ArenaRoom extends Room<ArenaState> {
  override maxClients = 8;

  override onCreate(): void {
    this.setState(new ArenaState());
  }

  override onJoin(client: Client, options: { name?: string }): void {
    const player = new Player();
    player.name = options.name ?? "anon";
    this.state.players.set(client.sessionId, player);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }
}
```

- [ ] **Step 6: Write `server/src/appConfig.ts`**

```ts
import config from "@colyseus/tools";
import { ROOM_NAME } from "@genzed/shared";
import { createApp } from "./app.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define(ROOM_NAME, ArenaRoom);
  },
  initializeExpress: (app) => {
    const baseApp = createApp();
    app.use(baseApp);
  },
});
```

- [ ] **Step 7: Add `@colyseus/tools` dep**

Edit `server/package.json` dependencies, add:

```json
"@colyseus/tools": "0.15.0"
```

Run: `pnpm install`
Expected: dep installed.

- [ ] **Step 8: Rewrite `server/src/index.ts` to use `appConfig`**

Replace `server/src/index.ts`:

```ts
import { listen } from "@colyseus/tools";
import appConfig from "./appConfig.js";

const PORT = Number(process.env.PORT ?? 2567);

listen(appConfig, PORT);
```

- [ ] **Step 9: Run tests, verify both pass**

Run: `pnpm --filter @genzed/server test`
Expected: 2 tests PASS (`healthz`, `ArenaRoom`).

- [ ] **Step 10: Commit**

```bash
git add server/ pnpm-lock.yaml
git commit -m "feat(server): add ArenaRoom with player join state"
```

---

## Task 7: Server dev verification

**Files:** none (verification only)

- [ ] **Step 1: Start server in dev mode**

Run: `pnpm --filter @genzed/server dev`
Expected: stdout includes `genzed server listening on :2567`. Process stays running.

- [ ] **Step 2: Hit `/healthz` from another terminal**

Run: `curl -s http://localhost:2567/healthz`
Expected output: `ok`

- [ ] **Step 3: Stop the dev server (Ctrl-C)**

No commit — verification step.

---

## Task 8: Client package — install deps

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/tsconfig.node.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`

- [ ] **Step 1: Write `client/package.json`**

```json
{
  "name": "@genzed/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "echo 'no lint yet'",
    "test": "echo 'no unit tests yet'"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "phaser": "3.80.1",
    "colyseus.js": "0.15.26",
    "@genzed/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.1",
    "typescript": "5.5.4",
    "vite": "5.4.2"
  }
}
```

- [ ] **Step 2: Write `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": []
  },
  "include": ["src"],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 3: Write `client/tsconfig.node.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "outDir": "dist-node",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Write `client/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/colyseus": { target: "ws://localhost:2567", ws: true },
      "/matchmake": { target: "http://localhost:2567", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

- [ ] **Step 5: Write `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Genzed</title>
    <style>
      html, body { margin: 0; padding: 0; background: #111; color: #eee; font-family: system-ui, sans-serif; }
      #root { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      #game { width: 800px; height: 600px; background: #000; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Install**

Run: `pnpm install`
Expected: client deps installed.

- [ ] **Step 7: Commit**

```bash
git add client/ pnpm-lock.yaml
git commit -m "chore(client): scaffold Vite + React + Phaser config"
```

---

## Task 9: Client package — minimal React + Phaser scene + Colyseus connect

**Files:**
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/game/GameMount.tsx`
- Create: `client/src/game/scenes/HelloScene.ts`
- Create: `client/src/game/net/connect.ts`

- [ ] **Step 1: Write `client/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: Write `client/src/App.tsx`**

```tsx
import { GameMount } from "./game/GameMount.js";

export function App(): JSX.Element {
  return (
    <>
      <h1>Genzed</h1>
      <GameMount />
    </>
  );
}
```

- [ ] **Step 3: Write `client/src/game/net/connect.ts`**

```ts
import { Client, type Room } from "colyseus.js";
import { COLYSEUS_PATH, ROOM_NAME } from "@genzed/shared";

export async function connectArena(name: string): Promise<Room> {
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const endpoint = `${wsProto}//${window.location.host}${COLYSEUS_PATH}`;
  const client = new Client(endpoint);
  return client.joinOrCreate(ROOM_NAME, { name });
}
```

- [ ] **Step 4: Write `client/src/game/scenes/HelloScene.ts`**

```ts
import Phaser from "phaser";

export type HelloSceneData = { status: string };

export class HelloScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super("hello");
  }

  override create(data: HelloSceneData): void {
    this.label = this.add.text(400, 300, data.status ?? "loading...", {
      color: "#ffffff",
      fontFamily: "monospace",
      fontSize: "20px",
    });
    this.label.setOrigin(0.5);
  }

  setStatus(status: string): void {
    this.label?.setText(status);
  }
}
```

- [ ] **Step 5: Write `client/src/game/GameMount.tsx`**

```tsx
import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { HelloScene } from "./scenes/HelloScene.js";
import { connectArena } from "./net/connect.js";

export function GameMount(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new HelloScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: "#000000",
      scene: [scene],
    });
    game.scene.start("hello", { status: "connecting..." });

    let cancelled = false;
    connectArena("guest")
      .then((room) => {
        if (cancelled) {
          room.leave();
          return;
        }
        scene.setStatus(`connected: ${room.sessionId}`);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(err);
        scene.setStatus("connection failed");
      });

    return () => {
      cancelled = true;
      game.destroy(true);
    };
  }, []);

  return <div id="game" ref={containerRef} />;
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @genzed/client typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/
git commit -m "feat(client): mount Phaser HelloScene and connect to Colyseus"
```

---

## Task 10: Local end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start everything**

Run: `pnpm dev`
Expected: two processes start. Vite at `http://localhost:5173`, server at `:2567`. No errors in either.

- [ ] **Step 2: Open browser**

Open `http://localhost:5173`. Expected: page title "Genzed", and the black Phaser canvas shows `connected: <some-id>` within ~1s.

- [ ] **Step 3: Verify server saw the join**

In the server terminal, no errors. Stop with Ctrl-C.

No commit — verification step.

---

## Task 11: Production build verification (without Docker)

**Files:** none (verification only)

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: `client/dist/index.html` and `client/dist/assets/*.js` exist. `server/dist/index.js` exists. No errors.

- [ ] **Step 2: Run built server, which serves built client**

Run: `PORT=8080 node server/dist/index.js`
Expected: stdout shows server listening on :8080.

- [ ] **Step 3: Open browser**

Open `http://localhost:8080`. Expected: same as Task 10 step 2 — Phaser canvas shows `connected: <id>`. This proves the single-port single-process production model works.

- [ ] **Step 4: Stop server**

No commit — verification step.

---

## Task 12: Multi-stage Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
**/node_modules
**/dist
.git
.github
legacy
docs
.idea
.DS_Store
playwright-report
test-results
*.log
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY shared shared
COPY client client
COPY server server
RUN pnpm build
RUN pnpm --filter @genzed/server deploy --prod /prod/server
RUN cp -r client/dist /prod/server/client-dist

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /prod/server ./
# server's static handler expects ../../client/dist relative to dist/server/src/...
# The deploy output puts compiled server at /app/dist/.  We arrange client bundle at /app/../client/dist
# by copying into /app/client/dist:
RUN mkdir -p ../client && mv client-dist ../client/dist || true
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/index.js"]
```

Note: the path gymnastics keep `path.resolve(__dirname, "../../client/dist")` in `server/src/app.ts` working. If this proves brittle, swap to an env var `CLIENT_DIST_DIR` in a follow-up — out of scope for v1.

- [ ] **Step 3: Build the image**

Run: `docker build -t genzed:local .`
Expected: build succeeds. Final image tagged `genzed:local`.

- [ ] **Step 4: Run the image**

Run: `docker run --rm -p 8080:8080 genzed:local`
Expected: server logs `genzed server listening on :8080`.

- [ ] **Step 5: Open browser**

Open `http://localhost:8080`. Expected: Phaser canvas shows `connected: <id>` exactly like Task 11.

- [ ] **Step 6: Stop container (Ctrl-C)**

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile for single-container deploy"
```

---

## Task 13: Fly.io deploy

**Files:**
- Create: `fly.toml`

This task assumes the user has `flyctl` installed and is authenticated (`fly auth login`). If not, ASK the user to run `fly auth login` in their terminal before continuing — do not attempt to authenticate from inside this plan.

- [ ] **Step 1: Create the Fly app**

ASK the user to run, in their terminal:

```bash
fly apps create genzed
```

Or pick a different name if `genzed` is taken (Fly app names are global). Record the chosen name as `<APP_NAME>` for subsequent steps.

- [ ] **Step 2: Write `fly.toml`**

Replace `<APP_NAME>` with the actual chosen name.

```toml
app = "<APP_NAME>"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/healthz"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

- [ ] **Step 3: Deploy**

ASK the user to run:

```bash
fly deploy
```

Expected: build pushes to Fly, image deploys, healthcheck passes. URL printed: `https://<APP_NAME>.fly.dev`.

- [ ] **Step 4: Verify**

ASK the user to open `https://<APP_NAME>.fly.dev` in a browser. Expected: Phaser canvas shows `connected: <id>`.

If it fails, common causes:
- Healthcheck timing out: bump `grace_period` to `30s`.
- WebSocket upgrade not happening: `force_https = true` requires the client URL to use `wss:` — `connect.ts` already handles this via `window.location.protocol`.

- [ ] **Step 5: Commit**

```bash
git add fly.toml
git commit -m "build: add Fly.io deploy config"
```

---

## Task 14: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test

  deploy:
    needs: build
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- [ ] **Step 2: Ask user to add the Fly token secret**

ASK the user to:
1. Run `fly tokens create deploy --expiry 8760h` and copy the output.
2. In GitHub repo settings → Secrets and variables → Actions → New repository secret → name `FLY_API_TOKEN`, value the token from step 1.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions build, typecheck, test, and Fly deploy"
```

- [ ] **Step 4: Push and verify**

ASK the user to push to a feature branch and open a PR (or push to `master` if they prefer). Verify the Actions run goes green and, on `master`, deploys to Fly.

---

## Task 15: README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Genzed

Multiplayer top-down battle arena. Modernized 2026 rewrite of a 2017 capstone project (Phaser 2 + socket.io). Original code preserved under `legacy/`.

## Stack

- **Client:** Phaser 3, React 18, Vite, TypeScript
- **Server:** Node 20, Colyseus, Express, TypeScript
- **Deploy:** Fly.io (single container)

## Development

Requires Node 20 and pnpm 9 (use `mise` to manage via `.tool-versions`).

```bash
pnpm install
pnpm dev          # client on :5173, server on :2567
pnpm test         # all packages
pnpm typecheck
pnpm build        # production bundle
```

After `pnpm build`, you can run the production server locally:

```bash
PORT=8080 node server/dist/index.js
```

and open `http://localhost:8080`.

## Deploy

`master` pushes auto-deploy to Fly.io via GitHub Actions. For manual deploy:

```bash
fly deploy
```

## Project structure

- `client/` — Phaser 3 + React 18 + Vite
- `server/` — Colyseus + Express on Node 20
- `shared/` — types and constants used by both
- `legacy/` — original 2017 code (read-only reference)
- `docs/superpowers/specs/` — design docs
- `docs/superpowers/plans/` — implementation plans
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for modernized stack"
```

---

## Task 16: Playwright smoke test (optional but recommended)

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/smoke.spec.ts`
- Modify: root `package.json` to add `test:e2e` script and `@playwright/test` devDep

- [ ] **Step 1: Add Playwright to root `package.json`**

Edit `package.json` `devDependencies` to add `"@playwright/test": "1.46.0"`. Add to `scripts`:

```json
"test:e2e": "playwright test"
```

Run: `pnpm install && pnpm exec playwright install --with-deps chromium`
Expected: chromium downloaded.

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write `tests/smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("loads, mounts Phaser, connects to Colyseus", async ({ page }) => {
  await page.goto("/");
  // The HelloScene renders text into a canvas, so we can't query DOM text.
  // Instead: assert no console errors and that the canvas exists with non-zero size.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 4: Run locally**

Run: `pnpm test:e2e`
Expected: 1 test PASSES.

- [ ] **Step 5: Wire into CI**

Edit `.github/workflows/ci.yml` `build` job, add after `pnpm test`:

```yaml
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/ .github/workflows/ci.yml
git commit -m "test: add Playwright smoke test for Phaser+Colyseus boot"
```

---

## Done criteria

When all 16 tasks are complete:

1. `pnpm dev` starts client + server locally and the browser shows "connected: \<id\>".
2. `pnpm build && node server/dist/index.js` does the same on a single port.
3. `docker build && docker run` does the same in a container.
4. `https://<APP_NAME>.fly.dev` shows the same in production.
5. Pushing to `master` triggers CI, which runs typecheck/build/test/e2e and deploys to Fly.
6. `legacy/` contains the untouched 2017 code, browsable but not built.

Stage 2 (lobby + room lifecycle) gets its own plan after Stage 1 is shipped.

## Self-review notes

- **Spec coverage:** every spec section relevant to Stage 1 — repo structure, stack, build, dev, deploy, CI, monorepo, single-deploy, no DB, single-port, drops list — has a task. Gameplay/netcode/lobby are explicitly Stage 2+.
- **Type consistency:** `ArenaState`, `Player`, `ArenaRoom`, `connectArena`, `HelloScene`, `createApp`, `ROOM_NAME`, `COLYSEUS_PATH`, `TICK_HZ` names match across tasks.
- **Dependency pinning:** all versions pinned to specific patch versions. If a version no longer resolves on npm at execution time, the executor should bump to the nearest patch and note it.
- **Known sharp edges:**
  - Dockerfile `client-dist` path gymnastics (Task 12) — works but is the most fragile step; consider `CLIENT_DIST_DIR` env var if it breaks.
  - Fly app name is global; user must pick one in Task 13 step 1.
  - `@colyseus/testing` API in Task 6 follows Colyseus 0.15 conventions; if version drift breaks the test API, executor should consult Colyseus docs and adjust.
