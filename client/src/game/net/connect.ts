import { Client, type Room } from "colyseus.js";
import { COLYSEUS_PATH, ROOM_NAME } from "@genzed/shared";
import type { ArenaState } from "../../lobby/arenaState.js";

const wsProto = (): "wss:" | "ws:" =>
  window.location.protocol === "https:" ? "wss:" : "ws:";

const endpoint = (): string =>
  `${wsProto()}//${window.location.host}${COLYSEUS_PATH}`;

export type ConnectedRoom = {
  room: Room<ArenaState>;
  reconnectionToken: string;
};

export async function joinArena(name: string): Promise<ConnectedRoom> {
  const client = new Client(endpoint());
  const room = await client.joinOrCreate<ArenaState>(ROOM_NAME, { name });
  return { room, reconnectionToken: room.reconnectionToken };
}

export async function reconnectArena(reconnectionToken: string): Promise<ConnectedRoom> {
  const client = new Client(endpoint());
  const room = await client.reconnect<ArenaState>(reconnectionToken);
  return { room, reconnectionToken: room.reconnectionToken };
}
