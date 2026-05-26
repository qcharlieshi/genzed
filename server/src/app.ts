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
