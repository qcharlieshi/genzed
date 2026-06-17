import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MSG_CHAT, EVT_CHAT, CHAT_MAX_LEN, type ChatEvent } from "@genzed/shared";
import { useRoom } from "../lobby/RoomContext.js";

const MAX_LINES = 8;

// TAB toggles (legacy bound chat to TAB, ESC to close — player.js:99-101);
// Enter sends and closes (legacy hid the chat container after submit).
// Messages render only while open, matching legacy's hidden container.
export function ChatOverlay(): JSX.Element | null {
  const { getRoom } = useRoom();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    // onMessage handlers accumulate on the Room across remounts — keep the detach.
    const detach = room.onMessage(EVT_CHAT, (m: ChatEvent) => {
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), m]);
    }) as unknown as () => void;
    return detach;
  }, [getRoom]);

  useEffect(() => {
    (window as unknown as { __chatOpen?: boolean }).__chatOpen = open;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Tab") {
        e.preventDefault(); // keep browser focus traversal out of the game
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (window as unknown as { __chatOpen?: boolean }).__chatOpen = false;
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (text.length > 0) getRoom()?.send(MSG_CHAT, { text });
      setDraft("");
      setOpen(false);
    },
    [draft, getRoom],
  );

  if (!open) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end p-3">
      <ul className="mb-2 max-w-md space-y-0.5 font-mono text-xs text-gray-100">
        {lines.map((l, i) => (
          <li key={`${l.name}-${i}`} className="rounded bg-black/60 px-2 py-0.5">
            <span className="font-bold text-emerald-300">{l.name}:</span> {l.text}
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="pointer-events-auto max-w-md">
        <input
          ref={inputRef}
          value={draft}
          maxLength={CHAT_MAX_LEN}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Talk some smack here..."
          className="w-full rounded border border-gray-700 bg-black/70 px-2 py-1 font-mono text-sm text-gray-100 outline-none"
        />
      </form>
    </div>
  );
}
