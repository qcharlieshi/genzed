import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") name = "";
}

export class ArenaState extends Schema {
  @type({ map: Player }) players: MapSchema<Player> = new MapSchema<Player>();
}
