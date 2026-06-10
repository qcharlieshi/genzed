import { useRoom } from "./RoomContext.js";

export function CountdownOverlay(): JSX.Element | null {
  const { phase, countdownMs } = useRoom();
  if (phase !== "starting") return null;
  const seconds = Math.max(0, Math.ceil(countdownMs / 1000));
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="text-8xl font-bold text-white tabular-nums">
        {seconds}
      </div>
    </div>
  );
}
