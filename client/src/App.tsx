import { useArenaRoom } from "./lobby/useArenaRoom.js";
import { RoomContext } from "./lobby/RoomContext.js";
import { NameEntry } from "./lobby/NameEntry.js";
import { Lobby } from "./lobby/Lobby.js";
import { CountdownOverlay } from "./lobby/CountdownOverlay.js";
import { ReconnectingBanner } from "./lobby/ReconnectingBanner.js";
import { GameMount } from "./game/GameMount.js";

export function App(): JSX.Element {
  const hook = useArenaRoom();

  let view: JSX.Element;
  if (
    (hook.status === "joined" || hook.status === "reconnecting") &&
    (hook.phase === "playing" || hook.phase === "ended")
  ) {
    // key=roomEpoch: a reconnect produces a new Room instance, but getRoom is a
    // stable callback so GameMount's effect never re-runs — remounting is what
    // rebinds Phaser (and prediction seeding) to the fresh room.
    view = <GameMount key={hook.roomEpoch} />;
  } else if (hook.status === "joined" || hook.status === "reconnecting") {
    view = (
      <>
        <Lobby />
        <CountdownOverlay />
      </>
    );
  } else {
    view = <NameEntry />;
  }

  return (
    <RoomContext.Provider value={hook}>
      {hook.status === "reconnecting" && <ReconnectingBanner />}
      {view}
    </RoomContext.Provider>
  );
}
