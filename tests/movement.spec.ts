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

  // Wait for sprites to register on both pages.
  await expect.poll(async () => (await players(pageA)).length, { timeout: 5_000 }).toBe(2);
  await expect.poll(async () => (await players(pageB)).length, { timeout: 5_000 }).toBe(2);

  const beforeA = (await players(pageA)).find((p) => p.local);
  const beforeB = (await players(pageB)).find((p) => !p.local);
  if (!beforeA || !beforeB) throw new Error("players not found in debug hook");

  await pageA.locator("canvas").click(); // focus
  await pageA.keyboard.down("w");
  await pageA.waitForTimeout(600);
  await pageA.keyboard.up("w");
  await pageA.waitForTimeout(400); // server settle + interp catch-up

  const afterA = (await players(pageA)).find((p) => p.local);
  const afterB = (await players(pageB)).find((p) => !p.local);
  if (!afterA || !afterB) throw new Error("players not found in debug hook");

  // Alice moved up on her own screen (prediction)...
  expect(beforeA.y - afterA.y).toBeGreaterThan(15);
  // ...and on Bob's screen (server broadcast + interpolation).
  expect(beforeB.y - afterB.y).toBeGreaterThan(15);

  await close();
  expect(errors).toEqual([]);
});
