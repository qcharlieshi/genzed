import { Room, type Client } from "@colyseus/core";
import { ArenaState, Player } from "../schema/ArenaState.js";

export class ArenaRoom extends Room<ArenaState> {
  override maxClients = 8;

  override onCreate(): void {
    this.setState(new ArenaState());
  }

  override onJoin(client: Client, options: { name?: string }): void {
    const player = new Player();
    player.name = options.name ?? "anon";
    this.state.players.set(client.sessionId, player);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }
}
