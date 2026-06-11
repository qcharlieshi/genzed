import { stepPlayer, type PlayerSim, type SimInput } from "./move.js";
import type { InputMessage } from "./messages.js";
import type { SolidityGrid } from "./grid.js";

// Client-side prediction for the local player; lives in shared so the parity
// test can drive it against the server path. Reconcile rebases the FULL sim
// from the server's authoritative schema and replays unacked inputs —
// identical math both sides, so corrections only fire on packet loss/reorder.
export class LocalPrediction {
  sim: PlayerSim;
  private pending: InputMessage[] = [];
  private nextSeq: number;

  // nextSeq must continue from the server's lastProcessedInput + 1 — on a
  // mid-game reconnect the server has already acked earlier seqs.
  constructor(
    sim: PlayerSim,
    private grid: SolidityGrid,
    nextSeq = 1,
  ) {
    this.sim = sim;
    this.nextSeq = nextSeq;
  }

  get x(): number {
    return this.sim.x;
  }

  get y(): number {
    return this.sim.y;
  }

  // Sample one 20 Hz input: apply locally, queue for reconciliation, return the
  // message to send. aimAngle is carried, not simulated.
  sample(input: SimInput, aimAngle: number): InputMessage {
    const msg: InputMessage = { ...input, seq: this.nextSeq, aimAngle };
    this.nextSeq += 1;
    this.pending.push(msg);
    this.sim = stepPlayer(this.grid, this.sim, msg).sim;
    return msg;
  }

  reconcile(serverSim: PlayerSim, lastProcessedInput: number): void {
    this.pending = this.pending.filter((p) => p.seq > lastProcessedInput);
    let sim = serverSim;
    for (const p of this.pending) {
      sim = stepPlayer(this.grid, sim, p).sim;
    }
    this.sim = sim;
  }
}
