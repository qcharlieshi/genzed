import { Schema, MapSchema, type } from "@colyseus/schema";
import type { Phase } from "@genzed/shared";

export class Player extends Schema {
  @type("string") name = "";
  @type("boolean") ready = false;
  @type("number") joinedAt = 0;
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}
