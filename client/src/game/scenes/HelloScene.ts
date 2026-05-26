import Phaser from "phaser";

export type HelloSceneData = { status: string };

export class HelloScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super("hello");
  }

  create(data: HelloSceneData): void {
    this.label = this.add.text(400, 300, data.status ?? "loading...", {
      color: "#ffffff",
      fontFamily: "monospace",
      fontSize: "20px",
    });
    this.label.setOrigin(0.5);
  }

  setStatus(status: string): void {
    this.label?.setText(status);
  }
}
