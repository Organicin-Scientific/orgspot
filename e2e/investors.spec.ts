import { expect, test } from "@playwright/test";

test.describe("investors", () => {
  test("directory, search, detail, add investor, groups, suppression", async ({ page }) => {
    await page.goto("/investors");

    await expect(page.getByRole("heading", { name: "Investors", level: 1 })).toBeVisible();
    await expect(page.getByRole("cell", { name: "alex.rivera.0@example.com", exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: "Search investors" }).fill("alex.rivera.0");
    await expect(page.getByRole("cell", { name: "alex.rivera.0@example.com", exact: true })).toBeVisible();

    await page.getByRole("cell", { name: "alex.rivera.0@example.com", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Alex Rivera/i, level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/investors/);

    await page.getByRole("button", { name: "Add investor" }).first().click();
    await expect(page.getByRole("heading", { name: "Add investor" })).toBeVisible();

    const unique = `e2e-${Date.now()}@example.com`;
    await page.getByLabel("First name", { exact: true }).fill("E2E");
    await page.getByLabel("Last name", { exact: true }).fill("Synthetic");
    await page.getByLabel("Email", { exact: true }).fill(unique);
    await page.getByLabel("Organization", { exact: true }).fill("Synthetic Ventures");
    await page.getByRole("button", { name: "Add investor" }).last().click();
    await expect(page.getByRole("cell", { name: unique, exact: true })).toBeVisible();

    await page.goto("/investors/groups");
    await expect(page.getByRole("heading", { name: "Groups", level: 1 })).toBeVisible();

    await page.goto("/investors/suppression");
    await expect(page.getByRole("heading", { name: "Suppression list", level: 1 })).toBeVisible();
  });
});
