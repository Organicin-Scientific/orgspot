import { expect, test } from "@playwright/test";

test.describe("auth (no saved session)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirect, dev sign-in, dashboard, sign out", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Local emulator sign-in").fill("admin@example.com");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /admin@example\.com/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
  });
});
