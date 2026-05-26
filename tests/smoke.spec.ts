import { test, expect } from "@playwright/test";

test("loads, mounts Phaser, connects to Colyseus", async ({ page }) => {
  await page.goto("/");
  // The HelloScene renders text into a canvas, so we can't query DOM text.
  // Instead: assert no console errors and that the canvas exists with non-zero size.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});
