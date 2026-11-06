import { defineConfig, devices } from "@playwright/test";

/**
 * Values mirror `.env.example` (synthetic / local only). Variables from `firebase emulators:exec`
 * (FIRESTORE_EMULATOR_HOST, etc.) are merged in so the dev server talks to the same emulators.
 */
const webServerEnv: Record<string, string> = {
  ...process.env,
  APP_ENV: process.env.APP_ENV ?? "local",
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? "demo-organicin",
  ALLOWED_FIREBASE_PROJECT_ID: process.env.ALLOWED_FIREBASE_PROJECT_ID ?? "demo-organicin",
  FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET ?? "demo-organicin.appspot.com",
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199",
  AUTH_REQUIRE_MFA: process.env.AUTH_REQUIRE_MFA ?? "false",
  SESSION_MAX_AGE_HOURS: process.env.SESSION_MAX_AGE_HOURS ?? "8",
  EMAIL_SENDING_ENABLED: process.env.EMAIL_SENDING_ENABLED ?? "false",
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "re_xxxxxxxx_replace_in_production",
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? "whsec_replace_in_production",
  RESEND_MAX_REQUESTS_PER_SECOND: process.env.RESEND_MAX_REQUESTS_PER_SECOND ?? "2",
  SENDER_EMAIL: process.env.SENDER_EMAIL ?? "updates@updates.example.com",
  CRON_SECRET: process.env.CRON_SECRET ?? "dev-only-cron-secret-change-me-0000000000",
  TOKEN_SIGNING_SECRET: process.env.TOKEN_SIGNING_SECRET ?? "dev-only-token-signing-secret-change-me-00000000",
  PDF_LINK_TTL_DAYS: process.env.PDF_LINK_TTL_DAYS ?? "30",
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "fake-api-key-replace",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "demo-organicin.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-organicin",
  NEXT_PUBLIC_FIREBASE_APP_ID:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:000000000000:web:0000000000000000000000",
  NEXT_PUBLIC_AUTH_EMULATOR_LOGIN: process.env.NEXT_PUBLIC_AUTH_EMULATOR_LOGIN ?? "true",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: [/auth\.spec\.ts/],
      use: { storageState: "e2e/.auth/user.json" },
    },
    {
      name: "chromium-unauth",
      dependencies: ["setup"],
      testMatch: [/auth\.spec\.ts/],
      use: { storageState: { cookies: [], origins: [] } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Avoid binding to a stale dev server (wrong Firebase project / env). Opt back in with PLAYWRIGHT_REUSE_SERVER=1.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    env: webServerEnv,
  },
});
