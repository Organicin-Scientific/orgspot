import { parseDoc } from "@/lib/content/schema";
import { getSettings, sendReadiness } from "@/server/db/settings";
import { getUpdate } from "@/server/db/updates";
import { GMAIL_CLIP_BYTES, personalize, renderUpdateEmail, testPersonalization } from "@/server/email/render";
import { badRequest, notFound } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { previewInput } from "@/server/http/schemas";
import { getAssets } from "@/server/storage";

/** Render the exact production email for the editor's current (possibly unsaved) content. */
export const POST = withAdmin<{ id: string }>(async ({ req, params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  const input = await readJson(req, previewInput, 800_000);
  const parsed = parseDoc(input.content);
  if (!parsed.ok) throw badRequest(parsed.error);
  const settings = await getSettings();
  const attachments = (await getAssets(input.attachmentIds)).filter((a) => a.kind === "attachment");
  const rendered = await renderUpdateEmail({
    title: input.title,
    subject: input.subject,
    previewText: input.previewText,
    content: parsed.doc,
    bannerAssetId: input.bannerAssetId,
    pdfDelivery: input.pdfDelivery,
    attachments,
    settings,
    mode: "preview",
  });
  const values = testPersonalization();
  return ok({
    html: personalize(rendered.html, values),
    text: personalize(rendered.text, values),
    sizeBytes: rendered.sizeBytes,
    clipped: rendered.sizeBytes > GMAIL_CLIP_BYTES,
    sender: settings.sender,
    readiness: sendReadiness(settings),
  });
});
