import "server-only";
import { createHash } from "node:crypto";
import { render } from "@react-email/render";
import { createElement } from "react";
import { InvestorUpdateEmail, type EmailModel } from "@/emails/investor-update";
import { docToPlainText } from "@/lib/content/plain-text";
import type { DocNode } from "@/lib/content/schema";
import type { AppSettings, PdfDelivery } from "@/lib/types";
import { BRAND_GOLD, DEFAULT_LOGO_PATH, LEAF_BULLET_PNG_PATH } from "@/lib/brand";
import { fontStack } from "../db/settings";
import { env } from "../env";
import { assetUrl, type StoredAsset } from "../storage";
import { assetPreviewToken } from "../tokens";

/** Per-recipient values are substituted into the frozen snapshot at send time. */
export const PLACEHOLDERS = {
  unsubscribe: "%%UNSUBSCRIBE_URL%%",
  pdf: "%%PDF_URL%%",
  file: (assetId: string) => `%%FILE_URL_${assetId}%%`,
} as const;

export interface RenderInput {
  title: string;
  subject: string;
  previewText: string;
  content: DocNode;
  bannerAssetId: string | null;
  pdfDelivery: PdfDelivery;
  attachments: Pick<StoredAsset, "id" | "filename">[];
  settings: AppSettings;
  /** "preview" uses short-lived tokens for unpublished images; others use the public asset URL. */
  mode: "preview" | "test" | "campaign";
}

export interface RenderedEmail {
  html: string;
  text: string;
  sizeBytes: number;
  hash: string;
}

export function pdfFilename(title: string): string {
  const base = title
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "investor-update"}.pdf`;
}

export function buildModel(input: RenderInput): EmailModel {
  const { settings } = input;
  const imageUrl = (id: string) =>
    input.mode === "preview" ? `${assetUrl(id)}?t=${encodeURIComponent(assetPreviewToken(id))}` : assetUrl(id);
  return {
    doc: input.content,
    previewText: input.previewText,
    branding: {
      companyName: settings.branding.companyName,
      logoUrl: settings.branding.logoAssetId
        ? imageUrl(settings.branding.logoAssetId)
        : `${env().APP_URL}${DEFAULT_LOGO_PATH}`,
      bulletUrl: `${env().APP_URL}${LEAF_BULLET_PNG_PATH}`,
      primaryColor: settings.branding.primaryColor,
      accentColor: BRAND_GOLD,
      textColor: settings.branding.textColor,
      fontStack: fontStack(settings.branding.fontFamily),
    },
    bannerUrl: input.bannerAssetId ? imageUrl(input.bannerAssetId) : null,
    resolveImage: imageUrl,
    pdf: {
      mode: input.pdfDelivery,
      url: input.pdfDelivery === "link" ? PLACEHOLDERS.pdf : null,
      filename: pdfFilename(input.title),
    },
    attachments: input.attachments.map((a) => ({ name: a.filename, url: PLACEHOLDERS.file(a.id) })),
    footer: {
      postalAddress: settings.postalAddress,
      note: settings.footerNote,
      unsubscribeUrl: PLACEHOLDERS.unsubscribe,
      replyTo: settings.sender.replyTo,
    },
    isTest: input.mode === "test",
  };
}

export function buildPlainText(input: RenderInput): string {
  const s = input.settings;
  const parts: string[] = [];
  if (input.mode === "test") parts.push("*** TEST EMAIL - this preview was not sent to investors ***", "");
  parts.push(s.branding.companyName.toUpperCase(), "", docToPlainText(input.content));
  if (input.pdfDelivery === "attach") parts.push("", `A PDF copy of this update (${pdfFilename(input.title)}) is attached.`);
  if (input.pdfDelivery === "link") parts.push("", `Download this update as a PDF: ${PLACEHOLDERS.pdf}`);
  for (const a of input.attachments) parts.push(`${a.filename}: ${PLACEHOLDERS.file(a.id)}`);
  parts.push(
    "",
    "--",
    `${s.branding.companyName}${s.postalAddress ? `, ${s.postalAddress}` : ""}`,
    s.footerNote,
    s.sender.replyTo ? `Questions? Reply to this email or write to ${s.sender.replyTo}.` : "",
    `Unsubscribe: ${PLACEHOLDERS.unsubscribe}`,
  );
  return parts.filter((p, i, arr) => !(p === "" && arr[i - 1] === "")).join("\n");
}

export async function renderUpdateEmail(input: RenderInput): Promise<RenderedEmail> {
  const model = buildModel(input);
  const html = await render(createElement(InvestorUpdateEmail, { model }), { pretty: false });
  const text = buildPlainText(input);
  const hash = createHash("sha256").update(html).update("\u0000").update(text).digest("hex");
  return { html, text, sizeBytes: Buffer.byteLength(html, "utf8"), hash };
}

/** Replace placeholders with per-recipient URLs. Values are URL-safe, so no extra escaping is required. */
export function personalize(content: string, values: Record<string, string>): string {
  let out = content;
  for (const [placeholder, value] of Object.entries(values)) out = out.split(placeholder).join(value);
  return out;
}

export function testPersonalization(): Record<string, string> {
  const base = env().APP_URL;
  return {
    [PLACEHOLDERS.unsubscribe]: `${base}/u/test`,
    [PLACEHOLDERS.pdf]: `${base}/d/test`,
  };
}

/** Gmail clips messages above roughly 102 KB of HTML. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
