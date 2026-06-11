import { test, expect } from "@playwright/test";
import { twoPlayersInArena } from "./helpers";

test("two players join, host starts, both see the arena", async ({ browser }) => {
  const { pageA, errors, close } = await twoPlayersInArena(browser);
  await pageA.waitForTimeout(500); // allow scenes to settle
  await close();
  expect(errors).toEqual([]);
});
