import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

type DebugPlayer = { id: string; x: number; y: number; local: boolean };

async function players(page: Page): Promise<DebugPlayer[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players: () => DebugPlayer[] } }).__arena;
    return hook ? hook.players() : [];
  });
}

test("movement propagates: local prediction and remote view both advance", async ({ browser }) => {
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);
  try {
    // Wait for sprites to register on both pages.
    await expect.poll(async () => (await players(pageA)).length, { timeout: 5_000 }).toBe(2);
    await expect.poll(async () => (await players(pageB)).length, { timeout: 5_000 }).toBe(2);

    const beforeA = (await players(pageA)).find((p) => p.local);
    const beforeB = (await players(pageB)).find((p) => !p.local);
    if (!beforeA || !beforeB) throw new Error("players not found in debug hook");

    await pageA.locator("canvas").click(); // focus
    await pageA.keyboard.down("w");
    // Poll while the key is held instead of betting on a fixed 600ms window —
    // displacement per wall-clock varies with runner load (CI missed >15px by
    // ~0.3px twice on the 2-core runner).
    // Alice moves up on her own screen immediately (prediction)...
    await expect
      .poll(
        async () => {
          const a = (await players(pageA)).find((p) => p.local);
          return a ? beforeA.y - a.y : 0;
        },
        { timeout: 5_000 },
      )
      .toBeGreaterThan(15);
    await pageA.keyboard.up("w");
    // ...and Bob's view converges after server broadcast + interpolation.
    await expect
      .poll(
        async () => {
          const b = (await players(pageB)).find((p) => !p.local);
          return b ? beforeB.y - b.y : 0;
        },
        { timeout: 5_000 },
      )
      .toBeGreaterThan(15);
  } finally {
    await close();
  }
  expect(errors).toEqual([]);
});
