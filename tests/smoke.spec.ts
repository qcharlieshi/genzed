import { test, expect, type Page } from "@playwright/test";

async function joinAs(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "player name" }).fill(name);
  await page.getByRole("button", { name: /join lobby/i }).click();
  await expect(page.getByText(`${name}`).first()).toBeVisible({ timeout: 10_000 });
}

test("two players join, host starts, both see the arena", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errors: string[] = [];
  for (const p of [pageA, pageB]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }

  await joinAs(pageA, "alice");
  await joinAs(pageB, "bob");

  // Both pages should see "2 / 4 players" in the lobby.
  await expect(pageA.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await expect(pageB.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });

  // Alice starts the game.
  await pageA.getByRole("button", { name: /start game/i }).click();

  // Both pages should reach the arena canvas within the countdown + small buffer.
  for (const p of [pageA, pageB]) {
    await expect(p.locator("canvas").first()).toBeVisible({ timeout: 8_000 });
  }

  // Allow scenes to settle.
  await pageA.waitForTimeout(500);

  await ctxA.close();
  await ctxB.close();

  expect(errors).toEqual([]);
});
