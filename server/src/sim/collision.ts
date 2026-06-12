import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSolidityGrid, type SolidityGrid, type TiledMapJson } from "@genzed/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In the container the map ships inside the built client bundle; in dev and in
// tests it's read from client/public. Both resolve relative to this file
// (server/src/sim or server/dist/sim → ../../../ = repo or /app root).
const CANDIDATES = [
  path.resolve(__dirname, "../../../client/dist/assets/maps/main.json"),
  path.resolve(__dirname, "../../../client/public/assets/maps/main.json"),
];

function readMapJson(): TiledMapJson {
  for (const candidate of CANDIDATES) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as TiledMapJson;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`arena map JSON not found; looked in:\n${CANDIDATES.join("\n")}`);
}

let cached: SolidityGrid | null = null;
let cachedBullet: SolidityGrid | null = null;

// Player grid: union of all collision-flagged layers (wall + water + litWall).
export function loadSolidityGrid(): SolidityGrid {
  if (!cached) cached = buildSolidityGrid(readMapJson());
  return cached;
}

// Bullet grid: wallCollision only — bullets fly over water and lit-wall tiles.
export function loadBulletGrid(): SolidityGrid {
  if (!cachedBullet) cachedBullet = buildSolidityGrid(readMapJson(), ["wallCollision"]);
  return cachedBullet;
}
