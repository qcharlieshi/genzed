import type Phaser from "phaser";
import { DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT } from "@genzed/shared";

export const PLAYER_ATLAS = "player";
export const IDLE_FRAME = "playerSprites_243.png";

export const ANIM = {
  down: "walk-down",
  up: "walk-up",
  right: "walk-right", // walking left = this animation with flipX (legacy behavior)
  idle: "idle",
} as const;

// DIR_LEFT maps to the right-walk animation — the scene sets flipX for left.
export const DIR_ANIM: Record<number, string> = {
  [DIR_DOWN]: ANIM.down,
  [DIR_UP]: ANIM.up,
  [DIR_LEFT]: ANIM.right,
  [DIR_RIGHT]: ANIM.right,
};

// Legacy player.js animation tables (numeric atlas indices), resolved to the
// frame names at those positions in playerRolls.json. 10 fps, looping.
const FRAMES: Record<string, string[]> = {
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

export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const [key, frames] of Object.entries(FRAMES)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: PLAYER_ATLAS, frame })),
      frameRate: 10,
      repeat: -1,
    });
  }
}
