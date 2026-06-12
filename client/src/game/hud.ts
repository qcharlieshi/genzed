import type Phaser from "phaser";
import { RELOAD_MS, gunForLevel } from "@genzed/shared";
import type { LobbyPlayer } from "../lobby/arenaState.js";
import { GUN_ATLAS } from "./animations.js";

export const HEARTS_KEY = "hearts";
export const GUN_CONTAINER_KEY = "gunContainer";
export const MEDALS_ATLAS = "medals";
export const RELOAD_ATLAS = "reloadBar";

const DEPTH = 900; // above the world, below the crosshair (1000)
const FEED_TTL_MS = 3000;
const FEED_MAX = 6;
const FEED_STYLE = { color: "#f6e05e", fontFamily: "monospace", fontSize: "11px" } as const;
const BANNER_STYLE = {
  color: "#f6e05e",
  fontFamily: "monospace",
  fontSize: "28px",
  align: "center",
} as const;

const reloadFrame = (i: number): string => `New Piskel (14)_${String(i + 1).padStart(2, "0")}.png`;
const medalFrame = (rank: number): string => `medals_0${Math.min(rank, 3) + 1}.png`;

export class ArenaHud {
  private hearts: Phaser.GameObjects.Sprite[] = [];
  private gunIcon: Phaser.GameObjects.Sprite;
  private ammoText: Phaser.GameObjects.Text;
  private medal: Phaser.GameObjects.Sprite;
  private reloadBar: Phaser.GameObjects.Sprite;
  private feedTexts: Phaser.GameObjects.Text[] = [];
  private banner: Phaser.GameObjects.Text;
  readonly feedLines: string[] = []; // rolling log, read by the E2E hook

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < 10; i += 1) {
      this.hearts.push(
        scene.add.sprite(16 + 32 * i, 16, HEARTS_KEY, 2).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH),
      );
    }
    scene.add.image(792, 8, GUN_CONTAINER_KEY).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH);
    this.gunIcon = scene.add
      .sprite(792 - 231 / 2, 60, GUN_ATLAS, "pistol.png")
      .setScale(3)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1);
    this.ammoText = scene.add
      .text(792 - 231 / 2, 108, "10 / 10", { color: "#e2e8f0", fontFamily: "monospace", fontSize: "14px" })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1);
    this.medal = scene.add
      .sprite(400, 16, MEDALS_ATLAS, medalFrame(0))
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.reloadBar = scene.add
      .sprite(400, 320, RELOAD_ATLAS, reloadFrame(0))
      .setScale(2)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setVisible(false);
    this.banner = scene.add
      .text(400, 260, "", BANNER_STYLE)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 2)
      .setVisible(false);
  }

  updateLocal(me: LobbyPlayer, rank: number): void {
    const full = Math.floor(me.hp / 10);
    this.hearts.forEach((heart, i) => {
      heart.setFrame(i < full ? 2 : i === full && me.hp % 10 >= 5 ? 1 : 0);
    });
    const gun = gunForLevel(me.gunLevel);
    this.gunIcon.setFrame(gun.gunFrame);
    const fmt = (n: number): string => (n === -1 ? "∞" : String(n));
    this.ammoText.setText(`${fmt(me.ammo)} / ${fmt(gun.clip)}`);
    this.medal.setFrame(medalFrame(rank));
  }

  // elapsedMs = time since the locally-observed reload start; null = not reloading.
  updateReload(elapsedMs: number | null, jammed: boolean): void {
    if (elapsedMs === null) {
      this.reloadBar.setVisible(false);
      this.reloadBar.clearTint();
      return;
    }
    this.reloadBar.setVisible(true);
    if (jammed) {
      this.reloadBar.setTint(0xff0000); // frame frozen where the jam happened
      return;
    }
    const frame = Math.min(29, Math.max(0, Math.floor((elapsedMs / RELOAD_MS) * 30)));
    this.reloadBar.setFrame(reloadFrame(frame));
  }

  flashReloadSuccess(): void {
    this.reloadBar.setTint(0x00ff7f); // legacy green; bar hides on the next update
  }

  pushFeedLine(text: string): void {
    this.feedLines.push(text);
    const t = this.scene.add
      .text(792, 0, text, FEED_STYLE)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.feedTexts.unshift(t);
    while (this.feedTexts.length > FEED_MAX) this.feedTexts.pop()?.destroy();
    this.layoutFeed();
    this.scene.time.delayedCall(FEED_TTL_MS, () => {
      const idx = this.feedTexts.indexOf(t);
      if (idx >= 0) this.feedTexts.splice(idx, 1);
      t.destroy();
      this.layoutFeed();
    });
  }

  private layoutFeed(): void {
    this.feedTexts.forEach((t, i) => t.setPosition(792, 150 + 14 * i));
  }

  showBanner(winnerName: string): void {
    this.banner.setText(`${winnerName} has won the game!\nreturning to lobby...`).setVisible(true);
  }
}
