import { expect, test } from "@playwright/test";

const MAIN_PAGES: { path: string; title: string }[] = [
  { path: "/", title: "Dashboard" },
  { path: "/investors", title: "Investors" },
  { path: "/updates", title: "Updates" },
  { path: "/analytics", title: "Analytics" },
];

test.describe("a11y smoke", () => {
  for (const { path, title } of MAIN_PAGES) {
    test(`h1 on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    });
  }
});
