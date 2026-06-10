import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState, LobbyPlayer } from "../../lobby/arenaState.js";

export type ArenaSceneData = {
  room: Room<ArenaState>;
  localSessionId: string;
};

export class ArenaScene extends Phaser.Scene {
  private header!: Phaser.GameObjects.Text;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private room!: Room<ArenaState>;
  private localSessionId = "";
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super("arena");
  }

  create(data: ArenaSceneData): void {
    this.room = data.room;
    this.localSessionId = data.localSessionId;

    this.header = this.add
      .text(400, 40, "GAME ON", {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "28px",
      })
      .setOrigin(0.5);

    // onAdd fires for existing items in @colyseus/schema 2.x — no separate forEach.
    this.unsubscribers.push(
      this.room.state.players.onAdd((p, id) => {
        if (!this.labels.has(id)) this.addLabel(id, p);
      }) as unknown as () => void,
    );
    this.unsubscribers.push(
      this.room.state.players.onRemove((_p, id) => this.removeLabel(id)) as unknown as () => void,
    );

    this.refreshHeader();
  }

  private addLabel(sessionId: string, player: LobbyPlayer): void {
    const y = 100 + this.labels.size * 28;
    const suffix = sessionId === this.localSessionId ? " (you)" : "";
    const label = this.add
      .text(400, y, `${player.name}${suffix}`, {
        color: "#9ae6b4",
        fontFamily: "monospace",
        fontSize: "20px",
      })
      .setOrigin(0.5);
    this.labels.set(sessionId, label);
    this.refreshHeader();
  }

  private removeLabel(sessionId: string): void {
    const label = this.labels.get(sessionId);
    if (label) {
      label.destroy();
      this.labels.delete(sessionId);
    }
    this.relayoutLabels();
    this.refreshHeader();
  }

  private relayoutLabels(): void {
    let i = 0;
    this.labels.forEach((label) => {
      label.setY(100 + i * 28);
      i += 1;
    });
  }

  private refreshHeader(): void {
    const count = this.labels.size;
    this.header.setText(`GAME ON — ${count} player${count === 1 ? "" : "s"}`);
  }

  shutdown(): void {
    this.unsubscribers.forEach((unsub) => {
      try { unsub(); } catch { /* ignore */ }
    });
    this.unsubscribers = [];
    this.labels.clear();
  }
}
