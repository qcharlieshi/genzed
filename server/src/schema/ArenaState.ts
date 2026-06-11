import { Schema, MapSchema, type } from "@colyseus/schema";
import type { Phase } from "@genzed/shared";
import { PLAYER_HEALTH, gunForLevel } from "@genzed/shared";

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
  // sim fields (Task 4)
  @type("uint8") rollTicksLeft = 0;
  @type("uint8") rollDirMask = 0;
  @type("uint8") rollCooldownTicks = 0;
  @type("uint8") speedBonus = 0;
  // combat fields
  @type("uint8") hp = PLAYER_HEALTH; // clamp to 0 before assigning — uint8 wraps
  @type("uint8") gunLevel = 1; // 1..6; 6 = won
  @type("int16") ammo = gunForLevel(1).clip; // -1 encodes ∞ (L5)
  @type("number") reloadStartedAt = 0; // server-clock ms; 0 = not reloading
  @type("float32") aimAngle = 0; // radians; remote gun rendering
  @type("number") immuneUntil = 0; // server-clock ms; respawn immunity
}

export class Bullet extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("uint8") level = 1; // sprite frame selection
  @type("uint32") spawnTick = 0; // L5 lifetime; client TTL fallback
  // shooter sessionId stays in room memory — kill credit is server business
}

export class ArenaState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("number") countdownMs = 0;
  @type("uint32") tick = 0;
  @type("string") winnerName = "";
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
}
