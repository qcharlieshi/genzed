import type Phaser from "phaser";
import { DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT } from "@genzed/shared";

export const PLAYER_ATLAS = "player";
export const GUN_ATLAS = "guns"; // finalGunSheet — gun AND bullet frames
export const CROSSHAIR_ATLAS = "crosshair";
export const CROSSHAIR_FRAME = "reticle_box_001.png";
export const IDLE_FRAME = "playerSprites_243.png";

export const ANIM = {
  down: "walk-down",
  up: "walk-up",
  right: "walk-right", // walking left = this animation with flipX (legacy behavior)
  idle: "idle",
  rollDown: "roll-down",
  rollUp: "roll-up",
  rollRight: "roll-right", // roll-left = this animation with flipX (legacy scale -1)
} as const;

// DIR_LEFT maps to the right-walk animation — the scene sets flipX for left.
export const DIR_ANIM: Record<number, string> = {
  [DIR_DOWN]: ANIM.down,
  [DIR_UP]: ANIM.up,
  [DIR_LEFT]: ANIM.right,
  [DIR_RIGHT]: ANIM.right,
};

// Legacy player.js animation tables (numeric atlas indices), resolved to the
// frame names at those positions in playerRolls.json. 10 fps. Use verbatim.
const WALK_FRAMES: Record<string, string[]> = {
  [ANIM.right]: [
    "playerSprites_57 copy.png",
    "lookingRightRightLegUp.png",
    "RightComingDown1.png",
    "playerSprites_266 copy.png",
    "movingRight4.png",
    "movingRight5.png",
  ],
  [ANIM.up]: [
    "movingUpRightFootDown.png",
    "FootComingDownRunningUpLeft.png",
    "movingUpAboutLeftFootDown.png",
    "RunningUp1.png",
    "FootComingDownRunningUpRight.png",
  ],
  [ANIM.down]: [
    "playerSprites_34 copy.png",
    "moveRightBothLegsUp (1).png",
    "playerSprites_29 copy.png",
    "playerSprites_30 copy.png",
    "bothFeetInAir1Down.png",
    "OneFootRunningDownLookingLeft.png",
  ],
  [ANIM.idle]: [IDLE_FRAME],
};

// Legacy roll tables (player.js:112-114 indices → playerRolls.json hash order).
// Played once per roll (no loop); the roll FSM flips back to walk/idle after.
const ROLL_FRAMES: Record<string, string[]> = {
  [ANIM.rollUp]: [
    "playerSprites_299.png",
    "playerSprites_289.png",
    "playerSprites_312.png",
    "playerSprites_286.png",
    "playerSprites_252.png",
    "playerSprites_253.png",
    "playerSprites_251.png",
  ],
  [ANIM.rollDown]: [
    "playerSprites_300.png",
    "playerSprites_292.png",
    "playerSprites_311.png",
    "playerSprites_256.png",
    "playerSprites_257.png",
    "playerSprites_255.png",
  ],
  [ANIM.rollRight]: [
    "playerSprites_244.png",
    "playerSprites_245.png",
    "playerSprites_243.png",
    "New Piskel (2).png",
    "New Piskel (3).png",
    "playerSprites_260.png",
  ],
};

// Roll animation by roll-direction mask — horizontal wins (same rule as walking).
export function rollAnimFor(mask: number): { key: string; flipX: boolean } {
  if ((mask & 8) !== 0) return { key: ANIM.rollRight, flipX: false };
  if ((mask & 4) !== 0) return { key: ANIM.rollRight, flipX: true };
  if ((mask & 1) !== 0) return { key: ANIM.rollUp, flipX: false };
  return { key: ANIM.rollDown, flipX: false };
}

export const ZOMBIE_ATLAS = "zombie";

export const ZOMBIE_ANIM = {
  walk: "zombie-walk",
  dead: "zombie-dead",
} as const;

// Legacy enemy.js:9-10 numeric indices resolved against zombieSheet.json hash
// order (verified during planning — do not re-derive). 9 fps both. The art
// faces LEFT natively; the scene sets flipX when vx > 0.
const ZOMBIE_WALK_FRAMES = [
  "zombieWalk1.png",
  "zombieWalk2.png",
  "zombieWalk3.png",
  "zombieWalk4.png",
  "zombieWalk1.png",
  "zombieWalk5 (1).png",
  "zombieWalk7 (1).png",
];

const ZOMBIE_DEAD_FRAMES = [
  "zombieDeath2.png",
  "zombieDeath3.png",
  "zombieDeath4.png",
  "zombieDeath5.png",
  "zombieDeath6.png",
  "zombieDeath7 (1).png",
  "zombieDeath8.png",
  "zombieDeath9.png",
  "zombieDeath10.png",
];

export function registerZombieAnimations(scene: Phaser.Scene): void {
  if (!scene.anims.exists(ZOMBIE_ANIM.walk)) {
    scene.anims.create({
      key: ZOMBIE_ANIM.walk,
      frames: ZOMBIE_WALK_FRAMES.map((frame) => ({ key: ZOMBIE_ATLAS, frame })),
      frameRate: 9,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(ZOMBIE_ANIM.dead)) {
    scene.anims.create({
      key: ZOMBIE_ANIM.dead,
      frames: ZOMBIE_DEAD_FRAMES.map((frame) => ({ key: ZOMBIE_ATLAS, frame })),
      frameRate: 9,
      repeat: 0,
    });
  }
}

export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const [key, frames] of Object.entries(WALK_FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: -1,
    });
  }
  for (const [key, frames] of Object.entries(ROLL_FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: 0,
    });
  }
}
