import { getSettings } from "@/server/db/settings";
import { getUpdate } from "@/server/db/updates";
import { renderUpdatePdf } from "@/server/email/pdf";
import { pdfFilename } from "@/server/email/render";
import { notFound } from "@/server/http/errors";
import { withAdmin } from "@/server/http/handler";

export const maxDuration = 60;

/** PDF of the saved draft, for preview and download inside the app. */
export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  const pdf = await renderUpdatePdf({
    title: update.title,
    content: update.content,
    bannerAssetId: update.bannerAssetId,
    settings: await getSettings(),
    dateLabel: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  });
  const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${pdfFilename(update.title)}"`,
    },
  });
});
