import { INTERP_BUFFER_MS } from "@genzed/shared";

type Snapshot = { t: number; x: number; y: number; dir: number };

export type InterpSample = { x: number; y: number; dir: number; moving: boolean };

// Render remote players INTERP_BUFFER_MS in the past, lerping between the two
// bracketing server snapshots (standard Colyseus interpolation pattern).
export class RemoteInterpolation {
  private buf: Snapshot[] = [];

  // Indexed reads are guarded throughout — noUncheckedIndexedAccess is on.
  push(x: number, y: number, dir: number): void {
    const now = performance.now();
    this.buf.push({ t: now, x, y, dir });
    const cutoff = now - 1000;
    while (this.buf.length > 2) {
      const head = this.buf[0];
      if (!head || head.t >= cutoff) break;
      this.buf.shift();
    }
  }

  sample(): InterpSample | null {
    const newest = this.buf[this.buf.length - 1];
    const oldest = this.buf[0];
    if (!newest || !oldest) return null;
    const target = performance.now() - INTERP_BUFFER_MS;
    if (target >= newest.t) {
      return { x: newest.x, y: newest.y, dir: newest.dir, moving: false };
    }
    if (target <= oldest.t) {
      return { x: oldest.x, y: oldest.y, dir: oldest.dir, moving: false };
    }
    for (let i = this.buf.length - 2; i >= 0; i -= 1) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (!a || !b || a.t > target) continue;
      const f = (target - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        dir: b.dir,
        moving: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 0.5,
      };
    }
    return { x: oldest.x, y: oldest.y, dir: oldest.dir, moving: false };
  }
}
