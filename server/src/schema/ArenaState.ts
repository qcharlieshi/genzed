import { Schema, MapSchema, type } from "@colyseus/schema";
import type { Phase } from "@genzed/shared";

export class Player extends Schema {
  @type("string") name = "";
  @type("boolean") ready = false;
  @type("number") joinedAt = 0;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("uint8") dir = 0; // DIR_DOWN/UP/LEFT/RIGHT from @genzed/shared tuning
  @type("uint32") lastProcessedInput = 0;
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
}
