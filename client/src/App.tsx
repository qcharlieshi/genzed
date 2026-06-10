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
  if ((hook.status === "joined" || hook.status === "reconnecting") && hook.phase === "playing") {
    view = <GameMount />;
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
