import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  MSG_INPUT,
  MSG_FIRE,
  MSG_RELOAD,
  MSG_ACTIVE_RELOAD,
  MSG_DEV_TELEPORT,
  TICK_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  RECONCILE_SNAP_PX,
  RESPAWN_IMMUNITY_MS,
  DIR_LEFT,
  buildSolidityGrid,
  gunForLevel,
  LocalPrediction,
  type PlayerSim,
  type SimInput,
  type SolidityGrid,
  type TiledMapJson,
} from "@genzed/shared";
import type { ArenaState, BulletView, LobbyPlayer } from "../../lobby/arenaState.js";
import {
  ANIM,
  CROSSHAIR_ATLAS,
  CROSSHAIR_FRAME,
  DIR_ANIM,
  GUN_ATLAS,
  IDLE_FRAME,
  PLAYER_ATLAS,
  registerPlayerAnimations,
  rollAnimFor,
} from "../animations.js";
import { RemoteInterpolation } from "../net/interpolation.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

type PlayerView = {
  player: LobbyPlayer; // live schema ref
  sprite: Phaser.GameObjects.Sprite;
  gun: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  interp: RemoteInterpolation | null; // null for the local player
  prevImmuneUntil: number;
  unsubscribe: () => void;
};

type BulletSpriteView = {
  bullet: BulletView; // live schema ref
  sprite: Phaser.GameObjects.Sprite;
  unsubscribe: () => void;
};

type ArenaDebugHook = {
  players: () => Array<{ id: string; x: number; y: number; hp: number; gunLevel: number; local: boolean }>;
  fire: (tx: number, ty: number) => void;
  teleport: (x: number, y: number) => void;
  // Consented leave so E2E teardown doesn't trip the 10s reconnection grace.
  leave: () => void;
};

const MAP_KEY = "arena-map";
const TILESET_KEYS = ["dungeon", "dungeonObjs"] as const; // must match tileset names in main.json
const LAYER_NAMES = [
  "floor",
  "wallCollision",
  "waterCollision",
  "litWallCollision",
  "decorationWall",
  "decorationCollision",
]; // legacy draw order

const LABEL_STYLE = {
  color: "#9ae6b4",
  fontFamily: "monospace",
  fontSize: "10px",
} as const;

const GUN_ORBIT_PX = 10; // legacy gun.pivot.x = -10
const IMMUNITY_TINT = 0x66ccff;

function simFromPlayer(p: LobbyPlayer): PlayerSim {
  return {
    x: p.x,
    y: p.y,
    dir: p.dir,
    rollTicksLeft: p.rollTicksLeft,
    rollDirMask: p.rollDirMask,
    rollCooldownTicks: p.rollCooldownTicks,
    speedBonus: p.speedBonus,
  };
}

export class ArenaScene extends Phaser.Scene {
  private room!: Room<ArenaState>;
  private localSessionId = "";
  private views = new Map<string, PlayerView>();
  private bulletViews = new Map<string, BulletSpriteView>();
  private grid!: SolidityGrid;
  private prediction: LocalPrediction | null = null;
  private keys!: Record<"W" | "A" | "S" | "D" | "SPACE" | "R", Phaser.Input.Keyboard.Key>;
  private crosshair!: Phaser.GameObjects.Image;
  private localAimAngle = 0;
  private nextFireAt = 0; // client-side mirror of the fire gate (server re-gates)
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super("arena");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/main.json");
    this.load.image("dungeon", "assets/images/mapTiles/dungeon_tileset_32.png");
    this.load.image("dungeonObjs", "assets/images/mapTiles/objects_tilset_32.png");
    this.load.atlas(PLAYER_ATLAS, "assets/images/playerRolls.png", "assets/images/playerRolls.json");
    this.load.atlas(GUN_ATLAS, "assets/images/finalGunSheet.png", "assets/images/finalGunSheet.json");
    this.load.atlas(CROSSHAIR_ATLAS, "assets/images/crosshair.png", "assets/images/crosshair.json");
  }

  create(data: ArenaSceneData): void {
    this.room = data.room;
    this.localSessionId = data.localSessionId;

    const map = this.make.tilemap({ key: MAP_KEY });
    const tilesets = TILESET_KEYS.map((key) => {
      const ts = map.addTilesetImage(key, key);
      if (!ts) throw new Error(`tileset missing from map: ${key}`);
      return ts;
    });
    for (const name of LAYER_NAMES) {
      map.createLayer(name, tilesets, 0, 0);
    }

    // Same grid the server simulates against, built from the same JSON.
    const mapJson = this.cache.tilemap.get(MAP_KEY)?.data as TiledMapJson;
    this.grid = buildSolidityGrid(mapJson);

    registerPlayerAnimations(this);

    // onAdd fires for existing items in @colyseus/schema 2.x — no separate forEach.
    this.unsubscribers.push(
      this.room.state.players.onAdd((p, id) => {
        if (!this.views.has(id)) this.addPlayer(id, p);
      }) as unknown as () => void,
      this.room.state.players.onRemove((_p, id) => this.removePlayer(id)) as unknown as () => void,
      this.room.state.bullets.onAdd((b, id) => {
        if (!this.bulletViews.has(id)) this.addBullet(id, b);
      }) as unknown as () => void,
      this.room.state.bullets.onRemove((_b, id) => this.removeBullet(id)) as unknown as () => void,
    );

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,R") as ArenaScene["keys"];
    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.sampleInput() });

    // Crosshair replaces the OS cursor over the arena.
    this.input.setDefaultCursor("none");
    this.crosshair = this.add.image(0, 0, CROSSHAIR_ATLAS, CROSSHAIR_FRAME).setDepth(1000);

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Phaser 3 does NOT auto-call a method named shutdown() (that was Phaser 2);
    // wire it explicitly or the schema listeners outlive the scene. Listen for
    // BOTH events: game.destroy(true) — GameMount's teardown path — emits only
    // DESTROY, never SHUTDOWN. shutdown() is idempotent.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.shutdown());

    // E2E hook (read by tests/movement.spec.ts and tests/combat.spec.ts).
    (window as unknown as { __arena?: ArenaDebugHook }).__arena = {
      players: () =>
        [...this.views.entries()].map(([id, view]) => ({
          id,
          x: view.sprite.x,
          y: view.sprite.y,
          hp: view.player.hp,
          gunLevel: view.player.gunLevel,
          local: id === this.localSessionId,
        })),
      fire: (tx: number, ty: number) => void this.room.send(MSG_FIRE, { tx, ty }),
      teleport: (x: number, y: number) => void this.room.send(MSG_DEV_TELEPORT, { x, y }),
      leave: () => void this.room.leave(true),
    };
  }

  private addPlayer(sessionId: string, player: LobbyPlayer): void {
    const isLocal = sessionId === this.localSessionId;
    const sprite = this.add.sprite(player.x, player.y, PLAYER_ATLAS, IDLE_FRAME).setDepth(5);
    sprite.play(ANIM.idle);
    const gun = this.add
      .sprite(player.x, player.y, GUN_ATLAS, gunForLevel(player.gunLevel).gunFrame)
      .setDepth(6);
    const label = this.add
      .text(player.x, player.y - 14, isLocal ? `${player.name} (you)` : player.name, LABEL_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(7);

    if (isLocal) {
      // Seed the seq counter past the server's watermark so a mid-game
      // reconnect doesn't send seqs the replay guard has already acked.
      this.prediction = new LocalPrediction(simFromPlayer(player), this.grid, player.lastProcessedInput + 1);
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      const unsubscribe = player.onChange(() => {
        this.prediction?.reconcile(simFromPlayer(player), player.lastProcessedInput);
      }) as unknown as () => void;
      this.views.set(sessionId, { player, sprite, gun, label, interp: null, prevImmuneUntil: player.immuneUntil, unsubscribe });
    } else {
      const interp = new RemoteInterpolation();
      interp.push(player.x, player.y, player.dir);
      const unsubscribe = player.onChange(() => {
        interp.push(player.x, player.y, player.dir);
      }) as unknown as () => void;
      this.views.set(sessionId, { player, sprite, gun, label, interp, prevImmuneUntil: player.immuneUntil, unsubscribe });
    }
  }

  private removePlayer(sessionId: string): void {
    const view = this.views.get(sessionId);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    view.gun.destroy();
    view.label.destroy();
    this.views.delete(sessionId);
  }

  private addBullet(id: string, bullet: BulletView): void {
    const sprite = this.add
      .sprite(bullet.x, bullet.y, GUN_ATLAS, gunForLevel(bullet.level).bulletFrame)
      .setRotation(Math.atan2(bullet.vy, bullet.vx))
      .setDepth(4);
    const unsubscribe = bullet.onChange(() => {
      sprite.setPosition(bullet.x, bullet.y); // server patch corrects dead reckoning
    }) as unknown as () => void;
    this.bulletViews.set(id, { bullet, sprite, unsubscribe });
  }

  private removeBullet(id: string): void {
    const view = this.bulletViews.get(id);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    this.bulletViews.delete(id);
  }

  private sampleInput(): void {
    if (!this.prediction) return;
    const input: SimInput = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
      roll: Phaser.Input.Keyboard.JustDown(this.keys.SPACE),
    };
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    this.localAimAngle = Math.atan2(pointer.worldY - this.prediction.y, pointer.worldX - this.prediction.x);
    const msg = this.prediction.sample(input, this.localAimAngle);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);

    const me = this.room.state.players.get(this.localSessionId);
    if (!me) return;

    // R: reload — or the active-reload attempt while a reload is running.
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.room.send(me.reloadStartedAt > 0 ? MSG_ACTIVE_RELOAD : MSG_RELOAD);
    }

    // Full-auto while held, self-gated at the gun's interval (server re-gates).
    if (pointer.isDown && performance.now() >= this.nextFireAt) {
      this.room.send(MSG_FIRE, { tx: pointer.worldX, ty: pointer.worldY });
      this.nextFireAt = performance.now() + gunForLevel(me.gunLevel).fireIntervalMs;
    }
  }

  private playRollAnimation(sprite: Phaser.GameObjects.Sprite, mask: number): void {
    const roll = rollAnimFor(mask);
    if (sprite.anims.currentAnim?.key !== roll.key) sprite.play(roll.key);
    sprite.setFlipX(roll.flipX);
  }

  private updateLocalAnimation(input: SimInput): void {
    const view = this.views.get(this.localSessionId);
    if (!view || !this.prediction) return;
    if (this.prediction.sim.rollTicksLeft > 0) {
      this.playRollAnimation(view.sprite, this.prediction.sim.rollDirMask);
      return;
    }
    const moving = input.up || input.down || input.left || input.right;
    if (!moving) {
      view.sprite.play(ANIM.idle, true);
      view.sprite.setFlipX(false);
      return;
    }
    // Horizontal wins on diagonals — same rule as the server's `dir`.
    // Walking left = the right animation mirrored (legacy behavior).
    const goingLeft = input.left && !input.right;
    const key = input.right || goingLeft ? ANIM.right : input.down ? ANIM.down : ANIM.up;
    view.sprite.play(key, true);
    view.sprite.setFlipX(goingLeft);
  }

  override update(_time: number, delta: number): void {
    // Local player: render toward the predicted position. Prediction advances in
    // tick-sized steps at 20 Hz; the per-frame lerp smooths that into continuous motion.
    const local = this.views.get(this.localSessionId);
    if (local && this.prediction) {
      const dx = this.prediction.x - local.sprite.x;
      const dy = this.prediction.y - local.sprite.y;
      if (Math.hypot(dx, dy) > RECONCILE_SNAP_PX) {
        local.sprite.setPosition(this.prediction.x, this.prediction.y);
      } else {
        const k = Math.min(1, delta / TICK_MS);
        local.sprite.x += dx * k;
        local.sprite.y += dy * k;
      }
    }

    // Remote players: sample INTERP_BUFFER_MS in the past; roll anim overrides walk.
    this.views.forEach((view, id) => {
      if (id === this.localSessionId) return;
      const s = view.interp?.sample();
      if (!s) return;
      view.sprite.setPosition(s.x, s.y);
      if (view.player.rollTicksLeft > 0) {
        this.playRollAnimation(view.sprite, view.player.rollDirMask);
      } else {
        view.sprite.play(s.moving ? (DIR_ANIM[s.dir] ?? ANIM.idle) : ANIM.idle, true);
        view.sprite.setFlipX(s.moving && s.dir === DIR_LEFT);
      }
    });

    // Guns orbit their player, rotated to aim; labels ride above; immunity tints.
    this.views.forEach((view, id) => {
      const angle = id === this.localSessionId ? this.localAimAngle : view.player.aimAngle;
      view.gun.setFrame(gunForLevel(view.player.gunLevel).gunFrame);
      view.gun.setPosition(
        view.sprite.x + Math.cos(angle) * GUN_ORBIT_PX,
        view.sprite.y + Math.sin(angle) * GUN_ORBIT_PX,
      );
      view.gun.setRotation(angle);
      view.gun.setFlipY(Math.abs(angle) > Math.PI / 2);
      view.label.setPosition(view.sprite.x, view.sprite.y - 14);
      if (view.player.immuneUntil > view.prevImmuneUntil) {
        // immuneUntil only ever increases on respawn (game-start reset lowers it to 0).
        view.sprite.setTint(IMMUNITY_TINT);
        this.time.delayedCall(RESPAWN_IMMUNITY_MS, () => view.sprite.clearTint());
      }
      view.prevImmuneUntil = view.player.immuneUntil;
    });

    // Bullets: dead-reckon between patches (linear motion — extrapolation exact).
    const dtSec = delta / 1000;
    this.bulletViews.forEach((view) => {
      view.sprite.x += view.bullet.vx * dtSec;
      view.sprite.y += view.bullet.vy * dtSec;
    });

    // Crosshair follows the pointer in world space.
    const pointer = this.input.activePointer;
    pointer.updateWorldPoint(this.cameras.main);
    this.crosshair.setPosition(pointer.worldX, pointer.worldY);
  }

  shutdown(): void {
    const safeUnsub = (fn: () => void): void => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    };
    this.unsubscribers.forEach(safeUnsub);
    this.unsubscribers = [];
    this.views.forEach((view) => safeUnsub(view.unsubscribe));
    this.views.clear();
    this.bulletViews.forEach((view) => safeUnsub(view.unsubscribe));
    this.bulletViews.clear();
    this.prediction = null;
    // Drop the E2E debug hook — otherwise it dangles holding the destroyed scene graph.
    delete (window as unknown as { __arena?: unknown }).__arena;
  }
}
