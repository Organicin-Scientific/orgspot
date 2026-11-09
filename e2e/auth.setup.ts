import { test as setup } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const authFile = path.join(process.cwd(), "e2e/.auth/user.json");

setup("authenticate", async ({ request }) => {
  await mkdir(path.dirname(authFile), { recursive: true });
  const base = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000";
  const res = await request.post(`${base}/api/auth/dev-login`, {
    data: { email: "admin@example.com" },
    headers: { Origin: base },
  });
  if (!res.ok()) {
    throw new Error(`dev-login failed: ${res.status()} ${await res.text()}`);
  }
  await request.storageState({ path: authFile });
});
