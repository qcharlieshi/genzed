import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { useRoom } from "../lobby/RoomContext.js";
import { ArenaScene } from "./scenes/ArenaScene.js";
import { ChatOverlay } from "./ChatOverlay.js";

export function GameMount(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { sessionId, getRoom } = useRoom();

  useEffect(() => {
    if (!containerRef.current) return;
    const room = getRoom();
    if (!room || !sessionId) return;

    const scene = new ArenaScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: "#000000",
      pixelArt: true,
      scene: [scene],
    });
    game.scene.start("arena", { room, localSessionId: sessionId });

    return () => {
      game.destroy(true);
    };
  }, [sessionId, getRoom]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="relative h-[600px] w-[800px]">
        <div ref={containerRef} className="h-full w-full" />
        <ChatOverlay />
      </div>
    </div>
  );
}
