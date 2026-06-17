import Phaser from "phaser";
import {
  CONE_ANGLE_RAD,
  CONE_LENGTH_PX,
  CONE_RAYS,
  CONE_DARKNESS_ALPHA,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  TILE_SIZE,
  isSolidTile,
  type SolidityGrid,
} from "@genzed/shared";

const RAY_STEP_PX = 4;

// Client-only port of the 2017 Lighting plugin: a 90°/270 px cone toward the
// pointer. ONE Graphics redrawn per frame feeds two GeometryMasks — normal on
// remote entities (hidden outside the cone), inverted on a darkness rect (the
// cone stays bright). Purely cosmetic: a modified client could see everything —
// accepted at prototype tier (spec "out of scope").
export class VisionCone {
  private graphics: Phaser.GameObjects.Graphics;
  readonly mask: Phaser.Display.Masks.GeometryMask;
  private darkness: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, private grid: SolidityGrid) {
    this.graphics = scene.add.graphics().setVisible(false); // mask source only
    this.mask = this.graphics.createGeometryMask();
    this.darkness = scene.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, CONE_DARKNESS_ALPHA)
      .setOrigin(0)
      .setDepth(40);
    const inverted = this.graphics.createGeometryMask();
    inverted.invertAlpha = true;
    this.darkness.setMask(inverted);
  }

  // Redraw the cone polygon from the local player toward aimAngle, raycasting
  // the sight grid (60 rays × 4 px steps — trivial per frame).
  update(px: number, py: number, aimAngle: number): void {
    const g = this.graphics;
    g.clear();
    g.fillStyle(0xffffff, 1);
    const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(px, py)];
    for (let i = 0; i <= CONE_RAYS; i += 1) {
      const angle = aimAngle - CONE_ANGLE_RAD / 2 + (CONE_ANGLE_RAD * i) / CONE_RAYS;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let lastX = px;
      let lastY = py;
      for (let d = RAY_STEP_PX; d <= CONE_LENGTH_PX; d += RAY_STEP_PX) {
        const x = px + cos * d;
        const y = py + sin * d;
        if (isSolidTile(this.grid, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) break;
        lastX = x;
        lastY = y;
      }
      points.push(new Phaser.Math.Vector2(lastX, lastY));
    }
    g.fillPoints(points, true);
  }

  destroy(): void {
    this.darkness.destroy();
    this.graphics.destroy();
  }
}
