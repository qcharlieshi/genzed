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

let cached: SolidityGrid | null = null;

export function loadSolidityGrid(): SolidityGrid {
  if (cached) return cached;
  for (const candidate of CANDIDATES) {
    try {
      const json = JSON.parse(readFileSync(candidate, "utf8")) as TiledMapJson;
      cached = buildSolidityGrid(json);
      return cached;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`arena map JSON not found; looked in:\n${CANDIDATES.join("\n")}`);
}
