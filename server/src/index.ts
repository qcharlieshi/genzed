/* global process */
import { listen } from "@colyseus/tools";
import appConfig from "./appConfig.js";

const PORT = Number(process.env.PORT ?? 2567);

listen(appConfig, PORT);
