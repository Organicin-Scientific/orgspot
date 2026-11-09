import { expect, test } from "@playwright/test";

test.describe("update editor and sandbox send", () => {
  test("new update, preview tabs, send flow, analytics delivered", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByRole("button", { name: "New Update" }).click();
    await expect(page).toHaveURL(/\/updates\/[a-zA-Z0-9_-]+$/, { timeout: 30_000 });

    await page.getByRole("textbox", { name: "Update title" }).fill("E2E synthetic update");
    await page.locator(".ProseMirror").click();
    await page.locator(".ProseMirror").fill("Synthetic quarterly highlights for automated testing.");

    await page.getByRole("tab", { name: "Email" }).click();
    await page.getByLabel("Subject line").fill("E2E synthetic subject");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+S");
    await expect(page.getByTestId("update-save-indicator")).toHaveAttribute("data-save-state", "saved", { timeout: 60_000 });

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Desktop" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Plain text" })).toBeVisible();

    await page.getByRole("tab", { name: "Desktop" }).click();
    await expect(page.getByTitle("Email to be sent").contentFrame()).toBeTruthy();

    await page.getByRole("tab", { name: "Mobile" }).click();
    await expect(page.getByTitle("Email to be sent").contentFrame()).toBeTruthy();

    await page.getByRole("tab", { name: "Plain text" }).click();
    await expect(page.getByRole("dialog").locator("pre")).toContainText("Synthetic quarterly highlights");

    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Review & send" }).click();
    await expect(page).toHaveURL(/\/send$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Review and send", level: 1 })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("checkbox", { name: /^Board/ }).click();
    await page.getByRole("button", { name: /Prepare review/ }).click();

    await expect(page.getByText("2. Review the email")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Confirm and Send" }).first().click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    const finalSend = dialog.getByRole("button", { name: "Confirm and Send" }).last();
    await expect(finalSend).toBeDisabled();

    await dialog.getByRole("checkbox").click();
    await expect(finalSend).toBeEnabled();
    await finalSend.click();

    await expect(page).toHaveURL(/\/analytics\/[^/]+/, { timeout: 30_000 });

    await expect(async () => {
      const block = page.locator("div.rounded-xl.border.bg-card.p-4").filter({ has: page.getByText("Delivered", { exact: true }) });
      const line = block.getByText(/\d+ of \d+ accepted/);
      await expect(line).toBeVisible();
      const t = await line.innerText();
      const m = t.match(/(\d[\d,]*)\s+of/);
      if (!m) throw new Error(`unexpected Delivered line: ${t}`);
      expect(Number(m[1]!.replace(/,/g, ""))).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000 });
  });
});
