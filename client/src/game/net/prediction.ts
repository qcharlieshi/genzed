import { stepPlayer, type InputMessage, type MoveInput, type SolidityGrid } from "@genzed/shared";

// Client-side prediction for the local player. `x/y` is the predicted position;
// the scene renders toward it. Reconcile rebases onto the server's authoritative
// position and replays unacked inputs — identical math both sides, so the result
// matches the prediction except after packet loss/reorder.
export class LocalPrediction {
  x: number;
  y: number;
  private pending: InputMessage[] = [];
  private nextSeq: number;

  // nextSeq must continue from the server's lastProcessedInput + 1 — on a
  // mid-game reconnect the server has already acked earlier seqs, and the
  // replay guard drops anything at or below that watermark.
  constructor(
    x: number,
    y: number,
    private grid: SolidityGrid,
    nextSeq = 1,
  ) {
    this.x = x;
    this.y = y;
    this.nextSeq = nextSeq;
  }

  // Sample one 20 Hz input: apply locally, queue for reconciliation, return the
  // message to send to the server.
  sample(input: MoveInput): InputMessage {
    const msg: InputMessage = { seq: this.nextSeq, ...input };
    this.nextSeq += 1;
    this.pending.push(msg);
    const r = stepPlayer(this.grid, this.x, this.y, msg);
    this.x = r.x;
    this.y = r.y;
    return msg;
  }

  reconcile(serverX: number, serverY: number, lastProcessedInput: number): void {
    this.pending = this.pending.filter((p) => p.seq > lastProcessedInput);
    let x = serverX;
    let y = serverY;
    for (const p of this.pending) {
      const r = stepPlayer(this.grid, x, y, p);
      x = r.x;
      y = r.y;
    }
    this.x = x;
    this.y = y;
  }
}
