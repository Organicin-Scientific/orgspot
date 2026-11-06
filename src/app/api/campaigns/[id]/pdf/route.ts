import { getCampaign, snapshotPaths } from "@/server/campaigns/repo";
import { pdfFilename } from "@/server/email/render";
import { notFound } from "@/server/http/errors";
import { withAdmin } from "@/server/http/handler";
import { readFile } from "@/server/storage";

export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  const campaign = await getCampaign(params.id);
  if (!campaign || campaign.pdfDelivery === "none") throw notFound("This campaign has no PDF");
  const pdf = await readFile(snapshotPaths(params.id).pdf);
  const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${pdfFilename(campaign.title)}"`,
    },
  });
});
