import { useRoom } from "./RoomContext.js";

const MIN_TO_START = 2;
const MAX_PLAYERS = 4;

export function Lobby(): JSX.Element {
  const { players, sessionId, start, leave } = useRoom();
  const list = Array.from(players.entries()).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
  const canStart = list.length >= MIN_TO_START;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Genzed</h1>
          <p className="text-sm text-gray-400">
            {list.length} / {MAX_PLAYERS} players · need {MIN_TO_START} to start
          </p>
        </header>

        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900">
          {list.map(([id, p]) => (
            <li
              key={id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="font-medium text-gray-100">{p.name}</span>
              {id === sessionId && (
                <span className="text-xs uppercase tracking-wide text-emerald-400">
                  you
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="rounded-md bg-emerald-600 px-3 py-2 font-medium text-white disabled:bg-gray-700 disabled:text-gray-400"
          >
            Start Game
          </button>
          <button
            type="button"
            onClick={leave}
            className="rounded-md border border-gray-700 px-3 py-2 font-medium text-gray-200 hover:bg-gray-900"
          >
            Leave Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
