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
