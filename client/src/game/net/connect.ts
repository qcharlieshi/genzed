import { Client, type Room } from "colyseus.js";
import { COLYSEUS_PATH, ROOM_NAME } from "@genzed/shared";

export async function connectArena(name: string): Promise<Room> {
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const endpoint = `${wsProto}//${window.location.host}${COLYSEUS_PATH}`;
  const client = new Client(endpoint);
  return client.joinOrCreate(ROOM_NAME, { name });
}
