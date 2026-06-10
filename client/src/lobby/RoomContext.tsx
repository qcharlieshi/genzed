import { createContext, useContext } from "react";
import type { ArenaRoomHook } from "./useArenaRoom.js";

export const RoomContext = createContext<ArenaRoomHook | null>(null);

export function useRoom(): ArenaRoomHook {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside <RoomContext.Provider>");
  return value;
}
