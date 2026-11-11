import { parseDoc } from "@/lib/content/schema";
import { getSettings } from "@/server/db/settings";
import { getUpdate } from "@/server/db/updates";
import { renderUpdatePdf } from "@/server/email/pdf";
import { pdfFilename } from "@/server/email/render";
import { badRequest, notFound } from "@/server/http/errors";
import { contentDisposition } from "@/server/http/content-disposition";
import { readJson, withAdmin } from "@/server/http/handler";
import { previewInput } from "@/server/http/schemas";

export const maxDuration = 60;

const dateLabel = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

function pdfResponse(pdf: Buffer, title: string, kind: "inline" | "attachment") {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(kind, pdfFilename(title)),
      "Cache-Control": "no-store",
    },
  });
}

/** PDF of the saved draft, for preview and download inside the app. */
export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  const pdf = await renderUpdatePdf({
    title: update.title,
    content: update.content,
    bannerAssetId: update.bannerAssetId,
    settings: await getSettings(),
    dateLabel: dateLabel(),
  });
  return pdfResponse(pdf, update.title, req.nextUrl.searchParams.get("download") ? "attachment" : "inline");
});

/** PDF of the editor's current (possibly unsaved) content, for the preview's Download button. */
export const POST = withAdmin<{ id: string }>(async ({ req, params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  const input = await readJson(req, previewInput, 800_000);
  const parsed = parseDoc(input.content);
  if (!parsed.ok) throw badRequest(parsed.error);
  const title = input.title || update.title;
  const pdf = await renderUpdatePdf({
    title,
    content: parsed.doc,
    bannerAssetId: input.bannerAssetId,
    settings: await getSettings(),
    dateLabel: dateLabel(),
  });
  return pdfResponse(pdf, title, "attachment");
});
