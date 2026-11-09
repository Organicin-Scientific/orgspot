import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOGO_PATH } from "@/lib/brand";
import { defaultSettings } from "@/server/db/settings";
import type { DocNode } from "@/lib/content/schema";

vi.mock("@/server/storage", () => ({
  assetUrl: (id: string) => `https://app.example.test/api/assets/${id}`,
  loadAssetBuffers: async () => new Map(),
}));

beforeAll(() => {
  Object.assign(process.env, {
    APP_URL: "https://app.example.test",
    FIREBASE_PROJECT_ID: "demo-organicin",
    FIREBASE_STORAGE_BUCKET: "demo-organicin.appspot.com",
    CRON_SECRET: "x".repeat(32),
    TOKEN_SIGNING_SECRET: "y".repeat(32),
  });
});

const doc: DocNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };

function input(logoAssetId: string | null) {
  const settings = defaultSettings();
  settings.branding.logoAssetId = logoAssetId;
  return {
    title: "Q3 2026",
    subject: "Q3 2026",
    previewText: "",
    content: doc,
    bannerAssetId: null,
    pdfDelivery: "attach" as const,
    attachments: [],
    settings,
    mode: "campaign" as const,
  };
}

describe("default logo", () => {
  it("uses the Organicin wordmark in the email when no logo is uploaded", async () => {
    const { buildModel } = await import("@/server/email/render");
    expect(buildModel(input(null)).branding.logoUrl).toBe(`https://app.example.test${DEFAULT_LOGO_PATH}`);
  });

  it("prefers an uploaded logo", async () => {
    const { buildModel } = await import("@/server/email/render");
    expect(buildModel(input("abc123")).branding.logoUrl).toBe("https://app.example.test/api/assets/abc123");
  });

  it("embeds the wordmark in the PDF when no logo is uploaded", async () => {
    const { renderUpdatePdf } = await import("@/server/email/pdf");
    const { title, content, bannerAssetId, settings } = input(null);
    const pdf = await renderUpdatePdf({ title, content, bannerAssetId, settings, dateLabel: "November 2026" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toContain("/Subtype /Image");
    if (process.env.LOGO_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.LOGO_PDF_OUT, pdf);
  });
});
