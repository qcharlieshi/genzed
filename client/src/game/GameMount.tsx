import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { HelloScene } from "./scenes/HelloScene.js";

export function GameMount(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new HelloScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: "#000000",
      scene: [scene],
    });
    game.scene.start("hello", { status: "connecting..." });

    return () => {
      game.destroy(true);
    };
  }, []);

  return <div id="game" ref={containerRef} />;
}
