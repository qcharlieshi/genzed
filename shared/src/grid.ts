// Solidity grid built from the legacy Tiled JSON (old format: layer `properties`
// is a plain object and the collision flag is the string "true").

export type TiledLayer = {
  name: string;
  type: string;
  data?: number[];
  properties?: Record<string, unknown>;
};

export type TiledMapJson = {
  width: number; // tiles
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
};

export type SolidityGrid = {
  width: number; // tiles
  height: number;
  solid: Uint8Array; // 1 = blocked, row-major [ty * width + tx]
};

// layerNames: include exactly these tile layers (bullet grid = ["wallCollision"]).
// Omitted: include every layer flagged `collision: "true"` (the player grid).
export function buildSolidityGrid(map: TiledMapJson, layerNames?: readonly string[]): SolidityGrid {
  const solid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !layer.data) continue;
    const include = layerNames
      ? layerNames.includes(layer.name)
      : layer.properties?.collision === "true";
    if (!include) continue;
    for (let i = 0; i < layer.data.length; i += 1) {
      if ((layer.data[i] ?? 0) !== 0) solid[i] = 1; // ?? for noUncheckedIndexedAccess
    }
  }
  return { width: map.width, height: map.height, solid };
}

export function isSolidTile(grid: SolidityGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}
