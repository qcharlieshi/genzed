import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  MSG_INPUT,
  TICK_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  RECONCILE_SNAP_PX,
  DIR_LEFT,
  buildSolidityGrid,
  type MoveInput,
  type SolidityGrid,
  type TiledMapJson,
} from "@genzed/shared";
import type { ArenaState, LobbyPlayer } from "../../lobby/arenaState.js";
import { ANIM, DIR_ANIM, IDLE_FRAME, PLAYER_ATLAS, registerPlayerAnimations } from "../animations.js";
import { LocalPrediction } from "../net/prediction.js";
import { RemoteInterpolation } from "../net/interpolation.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

type PlayerView = {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  interp: RemoteInterpolation | null; // null for the local player
  unsubscribe: () => void;
};

type ArenaDebugHook = {
  players: () => Array<{ id: string; x: number; y: number; local: boolean }>;
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

export class ArenaScene extends Phaser.Scene {
  private room!: Room<ArenaState>;
  private localSessionId = "";
  private views = new Map<string, PlayerView>();
  private grid!: SolidityGrid;
  private prediction: LocalPrediction | null = null;
  private keys!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super("arena");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/main.json");
    this.load.image("dungeon", "assets/images/mapTiles/dungeon_tileset_32.png");
    this.load.image("dungeonObjs", "assets/images/mapTiles/objects_tilset_32.png");
    this.load.atlas(PLAYER_ATLAS, "assets/images/playerRolls.png", "assets/images/playerRolls.json");
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
    );

    this.keys = this.input.keyboard!.addKeys("W,A,S,D") as ArenaScene["keys"];
    this.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.sampleInput() });

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Phaser 3 does NOT auto-call a method named shutdown() (that was Phaser 2);
    // wire it explicitly or the schema listeners outlive the scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    // E2E hook (read by tests/movement.spec.ts).
    (window as unknown as { __arena?: ArenaDebugHook }).__arena = {
      players: () =>
        [...this.views.entries()].map(([id, view]) => ({
          id,
          x: view.sprite.x,
          y: view.sprite.y,
          local: id === this.localSessionId,
        })),
    };
  }

  private addPlayer(sessionId: string, player: LobbyPlayer): void {
    const isLocal = sessionId === this.localSessionId;
    const sprite = this.add.sprite(player.x, player.y, PLAYER_ATLAS, IDLE_FRAME);
    sprite.play(ANIM.idle);
    const label = this.add
      .text(player.x, player.y - 14, isLocal ? `${player.name} (you)` : player.name, LABEL_STYLE)
      .setOrigin(0.5, 1);

    if (isLocal) {
      // Seed the seq counter past the server's watermark so a mid-game
      // reconnect doesn't send seqs the replay guard has already acked.
      this.prediction = new LocalPrediction(
        player.x,
        player.y,
        this.grid,
        player.lastProcessedInput + 1,
      );
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      const unsubscribe = player.onChange(() => {
        this.prediction?.reconcile(player.x, player.y, player.lastProcessedInput);
      }) as unknown as () => void;
      this.views.set(sessionId, { sprite, label, interp: null, unsubscribe });
    } else {
      const interp = new RemoteInterpolation();
      interp.push(player.x, player.y, player.dir);
      const unsubscribe = player.onChange(() => {
        interp.push(player.x, player.y, player.dir);
      }) as unknown as () => void;
      this.views.set(sessionId, { sprite, label, interp, unsubscribe });
    }
  }

  private removePlayer(sessionId: string): void {
    const view = this.views.get(sessionId);
    if (!view) return;
    view.unsubscribe();
    view.sprite.destroy();
    view.label.destroy();
    this.views.delete(sessionId);
  }

  private sampleInput(): void {
    if (!this.prediction) return;
    const input: MoveInput = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
    };
    const msg = this.prediction.sample(input);
    this.room.send(MSG_INPUT, msg);
    this.updateLocalAnimation(input);
  }

  private updateLocalAnimation(input: MoveInput): void {
    const view = this.views.get(this.localSessionId);
    if (!view) return;
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
    // 5 px steps at 20 Hz; the per-frame lerp smooths that into continuous motion.
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

    // Remote players: sample INTERP_BUFFER_MS in the past.
    this.views.forEach((view, id) => {
      if (id === this.localSessionId) return;
      const s = view.interp?.sample();
      if (!s) return;
      view.sprite.setPosition(s.x, s.y);
      view.sprite.play(s.moving ? (DIR_ANIM[s.dir] ?? ANIM.idle) : ANIM.idle, true);
      view.sprite.setFlipX(s.moving && s.dir === DIR_LEFT);
    });

    // Labels ride above sprites.
    this.views.forEach((view) => {
      view.label.setPosition(view.sprite.x, view.sprite.y - 14);
    });
  }

  shutdown(): void {
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    });
    this.unsubscribers = [];
    this.views.forEach((view) => view.unsubscribe());
    this.views.clear();
    this.prediction = null;
  }
}
