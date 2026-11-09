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

const doc: DocNode = {
  type: "doc",
  content: [
    { type: "pullQuote", content: [{ type: "text", text: "We have to do the impossible, but it is possible. - Kevin Garnett" }] },
    { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Commercial" }] },
    {
      type: "metrics",
      attrs: { items: [{ label: "Contracts signed", sublabel: "", value: "$239K+" }, { label: "Pipeline", sublabel: "next two quarters", value: "$800K+" }] },
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "The relationship with our Fortune 500 customer grew." }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Our animal health partner is now testing our material itself." }] }] },
      ],
    },
  ],
} as DocNode;

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

describe("brand defaults", () => {
  it("uses the brand green, Nunito Sans and the Amherst address", () => {
    const d = defaultSettings();
    expect(d.branding.primaryColor).toBe("#157A6E");
    expect(d.branding.fontFamily).toBe("nunito");
    expect(d.postalAddress).toBe("240 Thatcher Rd, Amherst, MA 01003, United States");
  });

  it("renders leaf bullets, the gold rule and Nunito Sans in the email", async () => {
    const { buildModel } = await import("@/server/email/render");
    const { render } = await import("@react-email/render");
    const { createElement } = await import("react");
    const { InvestorUpdateEmail } = await import("@/emails/investor-update");
    const html = await render(createElement(InvestorUpdateEmail, { model: buildModel(input(null)) }));
    expect(html).toContain("https://app.example.test/brand/leaf-bullet.png");
    expect(html).not.toContain("<ul");
    expect(html.toLowerCase()).toContain("2px solid #f2b772");
    expect(html).toContain("family=Nunito+Sans");
    expect(html).toContain("text-transform:uppercase");
    if (process.env.BRAND_HTML_OUT) (await import("node:fs")).writeFileSync(process.env.BRAND_HTML_OUT, html);
  });
});

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
    expect(pdf.toString("latin1")).toContain("NunitoSans");
    if (process.env.LOGO_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.LOGO_PDF_OUT, pdf);
  });
});

describe("brand assets are public", () => {
  it("keeps /brand out of the login proxy so email clients can load the logo and bullets", async () => {
    const { config } = await import("@/proxy");
    const source = (config.matcher[0] as { source: string }).source;
    const re = new RegExp(`^${source}$`);
    expect(re.test("/brand/organicin-logo.png")).toBe(false);
    expect(re.test("/brand/leaf-bullet.png")).toBe(false);
    expect(re.test("/updates/abc")).toBe(true);
  });
});
