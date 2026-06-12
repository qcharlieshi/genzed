import { expect, type Browser, type Page } from "@playwright/test";

export async function joinAs(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "player name" }).fill(name);
  await page.getByRole("button", { name: /join lobby/i }).click();
  await expect(page.getByText(`${name}`).first()).toBeVisible({ timeout: 10_000 });
}

export async function twoPlayersInArena(browser: Browser): Promise<{
  pageA: Page;
  pageB: Page;
  errors: string[];
  close: () => Promise<void>;
}> {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Benign teardown race: the client input/ping loop can fire one last send
  // while a consented leave is closing the socket; Chrome logs it as a console
  // error but it is not a page failure. (Stopping the input loop on leave is
  // a Stage-5 polish item.)
  const BENIGN_CONSOLE = /WebSocket is already in CLOSING or CLOSED state/;
  const errors: string[] = [];
  for (const p of [pageA, pageB]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => {
      if (msg.type() === "error" && !BENIGN_CONSOLE.test(msg.text())) errors.push(msg.text());
    });
  }

  await joinAs(pageA, "alice");
  await joinAs(pageB, "bob");
  await expect(pageA.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await expect(pageB.getByText(/2 \/ 4 players/i)).toBeVisible({ timeout: 5_000 });
  await pageA.getByRole("button", { name: /start game/i }).click();
  for (const p of [pageA, pageB]) {
    await expect(p.locator("canvas").first()).toBeVisible({ timeout: 8_000 });
  }

  return {
    pageA,
    pageB,
    errors,
    close: async () => {
      // Consented leave via the debug hook — closing a context is a
      // non-consented leave, which keeps the room alive for the 10s
      // reconnection grace and blocks the next test's joinOrCreate.
      // Runs from finally blocks: swallow page errors so a dead page
      // doesn't mask the assertion that actually failed the test.
      for (const p of [pageA, pageB]) {
        await p
          .evaluate(() => {
            (window as unknown as { __arena?: { leave: () => void } }).__arena?.leave();
          })
          .catch(() => {});
      }
      await pageA.waitForTimeout(300).catch(() => {}); // let the server drop the room
      await ctxA.close();
      await ctxB.close();
    },
  };
}
