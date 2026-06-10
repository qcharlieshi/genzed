import { useState } from "react";
import type { FormEvent } from "react";
import { useRoom } from "./RoomContext.js";

export function NameEntry(): JSX.Element {
  const { status, error, join } = useRoom();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const disabled = status === "joining" || trimmed.length === 0 || trimmed.length > 20;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!disabled) void join(trimmed);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-center">Genzed</h1>
        <p className="text-sm text-gray-400 text-center">
          Pick a name to join the lobby.
        </p>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="your name"
          className="w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-base text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="player name"
        />
        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white disabled:bg-gray-700 disabled:text-gray-400"
        >
          {status === "joining" ? "Joining…" : "Join Lobby"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {humanizeError(error.code, error.message)}
          </p>
        )}
      </form>
    </div>
  );
}

function humanizeError(code: number, fallback: string): string {
  switch (code) {
    case 4001:
      return "A game is already in progress. Try again in a minute.";
    case 4003:
      return "Lobby is full (4/4).";
    default:
      return fallback;
  }
}
