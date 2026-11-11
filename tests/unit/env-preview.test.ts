import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/server/env";

describe("env preview APP_URL", () => {
  afterEach(() => {
    resetEnvCache();
  });

  it("derives APP_URL from VERCEL_URL on preview when APP_URL unset", () => {
    const saved = { ...process.env };
    try {
      process.env.APP_ENV = "preview";
      process.env.VERCEL_ENV = "preview";
      delete process.env.APP_URL;
      process.env.VERCEL_URL = "orgspot-git-feature-abc-organicin.vercel.app";
      process.env.FIREBASE_PROJECT_ID = "demo-organicin";
      process.env.FIREBASE_STORAGE_BUCKET = "demo-organicin.appspot.com";
      process.env.CRON_SECRET = "x".repeat(32);
      process.env.TOKEN_SIGNING_SECRET = "y".repeat(32);
      const e = env();
      expect(e.APP_URL).toBe("https://orgspot-git-feature-abc-organicin.vercel.app");
    } finally {
      process.env = saved;
      resetEnvCache();
    }
  });
});
