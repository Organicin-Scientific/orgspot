import path from "node:path";

import { expect, test } from "@playwright/test";

test.describe("import wizard", () => {
  test("CSV upload, mapping, review counts, confirm summary", async ({ page }) => {
    await page.goto("/investors/import");
    await expect(page.getByRole("heading", { name: "Import investors", level: 1 })).toBeVisible();

    const csvPath = path.join(process.cwd(), "e2e/fixtures/investors.csv");
    await page.setInputFiles('input[type="file"]', csvPath);

    await expect(page.getByText("Match your columns")).toBeVisible();
    await expect(page.getByText(/investors\.csv/)).toBeVisible();

    await page.getByRole("button", { name: "Review import" }).click();

    const statCard = (testId: string) => page.getByTestId(testId);
    await expect(statCard("import-review-new-contacts")).toContainText("1");
    await expect(statCard("import-review-already-in-directory")).toContainText("1");
    await expect(statCard("import-review-invalid-rows")).toContainText("1");
    await expect(statCard("import-review-duplicates-in-file")).toContainText("1");

    await page.getByRole("button", { name: /Import 1 new contact/ }).click();

    await expect(page.getByRole("main").getByText("Import complete")).toBeVisible();
    await expect(statCard("import-summary-contacts-added")).toContainText("1");
  });
});
