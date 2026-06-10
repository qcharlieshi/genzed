import { useRoom } from "./RoomContext.js";

export function ReconnectingBanner(): JSX.Element {
  const { reconnectSecondsLeft, giveUpReconnect } = useRoom();
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-20 flex items-center justify-between bg-yellow-600 px-4 py-2 text-sm text-white"
    >
      <span>Reconnecting… {reconnectSecondsLeft}s left</span>
      <button
        type="button"
        onClick={giveUpReconnect}
        className="rounded bg-yellow-700 px-2 py-1 text-xs font-medium hover:bg-yellow-800"
      >
        Give up
      </button>
    </div>
  );
}
