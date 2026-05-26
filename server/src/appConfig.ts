import { type ConfigOptions, listen } from "@colyseus/tools";
import { type Server } from "@colyseus/core";
import { type Express } from "express";
import { ROOM_NAME } from "@genzed/shared";
import { createApp } from "./app.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const appConfig: ConfigOptions = {
  initializeGameServer: (gameServer: Server) => {
    gameServer.define(ROOM_NAME, ArenaRoom);
  },
  initializeExpress: (app: Express) => {
    const baseApp = createApp();
    app.use(baseApp);
  },
};

export { listen };
export default appConfig;
