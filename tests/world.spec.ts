import { test, expect, type Page } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

type DebugZombie = { id: string; x: number; y: number };
type DebugPlayer = { id: string; x: number; y: number; hp: number; local: boolean };

async function hookReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __arena?: unknown }).__arena)), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function zombies(page: Page): Promise<DebugZombie[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { zombies(): DebugZombie[] } }).__arena;
    return hook ? hook.zombies() : [];
  });
}

async function players(page: Page): Promise<DebugPlayer[]> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __arena?: { players(): DebugPlayer[] } }).__arena;
    return hook ? hook.players() : [];
  });
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

async function setZombieSpawning(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as { __arena?: { setZombieSpawning(e: boolean): void } }).__arena?.setZombieSpawning(on);
  }, enabled);
}

async function spawnZombie(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([zx, zy]) => {
      (window as unknown as { __arena?: { spawnZombie(a: number, b: number): void } }).__arena?.spawnZombie(zx, zy);
    },
    [x, y] as const,
  );
}

async function feedHas(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((n) => {
    const hook = (window as unknown as { __arena?: { feed(): string[] } }).__arena;
    return hook?.feed().some((line) => line.includes(n)) ?? false;
  }, needle);
}

async function nearestZombieTo(page: Page, x: number, y: number): Promise<{ z: DebugZombie; d: number } | null> {
  const zs = await zombies(page);
  let best: { z: DebugZombie; d: number } | null = null;
  for (const z of zs) {
    const d = Math.hypot(z.x - x, z.y - y);
    if (!best || d < best.d) best = { z, d };
  }
  return best;
}

test("world layer: zombies spawn, chase, attack, die to bullets; pickups feed; chat relays", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { pageA, pageB, errors, close } = await twoPlayersInArena(browser);
  try {
    await hookReady(pageA);
    await hookReady(pageB);
    // Alice anchors the verified-clear corridor (player grid, y=128,
    // x 128..200); bob parks in the far corner — OFF alice's firing line, or
    // his AABB would eat the bullets meant for the zombies in step 4, and far
    // enough that dev-spawned zombies always pick alice as nearest.
    await teleportTo(pageA, 128, 128);
    await teleportTo(pageB, 992, 992);
    await pageA.waitForTimeout(500);

    // 1. The natural spawner works: a zombie appears (first spawn at 4 s).
    await expect.poll(async () => (await zombies(pageA)).length, { timeout: 12_000 }).toBeGreaterThan(0);

    // 2. Determinism from here on (addendum 3): stop the spawner — which also
    // clears live zombies — then plant one on the verified corridor (player
    // grid, y=128, x 128..200) 60 px from alice.
    await setZombieSpawning(pageA, false);
    await expect.poll(async () => (await zombies(pageA)).length, { timeout: 5_000 }).toBe(0);
    await spawnZombie(pageA, 188, 128);

    // 3. Chase + attack: it closes the 60 px (stops at the 28 px attack
    // range), then bites alice — 5 hp per swing, 1/s.
    await expect
      .poll(async () => (await nearestZombieTo(pageA, 128, 128))?.d ?? Infinity, { timeout: 10_000 })
      .toBeLessThan(35);
    await expect
      .poll(async () => (await players(pageA)).find((p) => p.local)?.hp ?? 100, { timeout: 10_000 })
      .toBeLessThan(100);

    // 4. Kill: plant a second zombie down the row — the player-grid wall pins
    // it at x≈264 (it can never reach alice) while the row stays clear on the
    // bullet grid. Fire at the nearest zombie's live position until the world
    // is zombie-free: the first bullet takes the point-blank attacker, the
    // next ones take the pinned zombie. One-hit-kill either way.
    await spawnZombie(pageA, 300, 128);
    await expect
      .poll(
        async () => {
          const zs = await zombies(pageA);
          if (zs.length === 0) return true;
          const me = (await players(pageA)).find((p) => p.local);
          if (!me) return false;
          let nearest = zs[0];
          let best = Infinity;
          for (const z of zs) {
            const d = Math.hypot(z.x - me.x, z.y - me.y);
            if (d < best) {
              best = d;
              nearest = z;
            }
          }
          if (nearest) await fireAt(pageA, nearest.x, nearest.y);
          return false;
        },
        { timeout: 20_000, intervals: [400] },
      )
      .toBe(true);

    // 5. Pickup: step onto the speed slot (544,573); both clients see the feed line.
    await teleportTo(pageA, 544, 573);
    await expect.poll(() => feedHas(pageA, "has picked up a speed boost"), { timeout: 5_000 }).toBe(true);
    await expect.poll(() => feedHas(pageB, "has picked up a speed boost"), { timeout: 5_000 }).toBe(true);

    // 6. Chat: alice TABs, types, Enter; the box closes; bob TABs and reads it.
    await pageA.keyboard.press("Tab");
    const input = pageA.getByPlaceholder("Talk some smack here...");
    await expect(input).toBeVisible();
    await input.fill("gg ez");
    await pageA.keyboard.press("Enter");
    await expect(input).toBeHidden();
    await pageB.keyboard.press("Tab");
    await expect(pageB.getByText("gg ez")).toBeVisible({ timeout: 5_000 });

    // Audio autoplay notices are environmental, not bugs (zombie sounds trip
    // them just like gunfire).
    const realErrors = errors.filter((e) => !/AudioContext|autoplay/i.test(e));
    expect(realErrors).toEqual([]);
  } finally {
    await close();
  }
});
