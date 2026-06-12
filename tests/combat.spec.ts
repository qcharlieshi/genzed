import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

// All evaluates inline the window access — closures don't serialize into the page.

// The canvas appears at Phaser boot, BEFORE create() installs window.__arena
// (preload now fetches ~MBs of audio) — wait for the hook or teleports no-op.
async function hookReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __arena?: unknown }).__arena)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function teleportTo(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]) => {
      (window as unknown as { __arena?: { teleport(a: number, b: number): void } }).__arena?.teleport(px, py);
    },
    [x, y] as const,
  );
}

async function fireAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([tx, ty]) => {
      (window as unknown as { __arena?: { fire(a: number, b: number): void } }).__arena?.fire(tx, ty);
    },
    [x, y] as const,
  );
}

async function ownHp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): Array<{ local: boolean; hp: number }> } }).__arena;
    return hook?.players().find((p) => p.local)?.hp ?? -1;
  });
}

async function ownGunLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): Array<{ local: boolean; gunLevel: number }> } })
      .__arena;
    return hook?.players().find((p) => p.local)?.gunLevel ?? -1;
  });
}

async function feedHas(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((n) => {
    const hook = (window as unknown as { __arena?: { feed(): string[] } }).__arena;
    return hook?.feed().some((line) => line.includes(n)) ?? false;
  }, needle);
}

test("A shoots B: hp drops, slain feed line on both clients, killer levels up, victim respawns", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);
  try {
    await hookReady(pageA);
    await hookReady(pageB);

    // Deterministic LoS pair, verified against the wallCollision grid.
    await teleportTo(pageA, 384, 416);
    await teleportTo(pageB, 224, 704);
    await pageA.waitForTimeout(500); // teleport patches settle

    // Fire until damage registers (pistol: 10 dmg, ~0.7 s flight).
    await expect
      .poll(
        async () => {
          await fireAt(pageA, 224, 704);
          return ownHp(pageB);
        },
        { timeout: 20_000, intervals: [400] },
      )
      .toBeLessThan(100);

    // Keep firing through the kill until the feed announces it.
    await expect
      .poll(
        async () => {
          await fireAt(pageA, 224, 704);
          return feedHas(pageA, "has slain");
        },
        { timeout: 30_000, intervals: [400] },
      )
      .toBe(true);

    // Victim respawned at (or near) full health — ≥90 tolerates one stray
    // in-flight bullet if the respawn rolled the same spawn point.
    await expect.poll(() => ownHp(pageB), { timeout: 5_000 }).toBeGreaterThanOrEqual(90);
    // Killer advanced to gun level 2; the broadcast reached the victim too.
    expect(await ownGunLevel(pageA)).toBe(2);
    expect(await feedHas(pageB, "has slain")).toBe(true);

    // Audio autoplay notices are environmental, not bugs.
    const realErrors = errors.filter((e) => !/AudioContext|autoplay/i.test(e));
    expect(realErrors).toEqual([]);
  } finally {
    await close();
  }
});
