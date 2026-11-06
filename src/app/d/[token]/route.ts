import type { NextRequest } from "next/server";
import { campaignsCol, getCampaign, recipientsCol, snapshotPaths } from "@/server/campaigns/repo";
import { pdfFilename } from "@/server/email/render";
import { log } from "@/server/logger";
import { clientIp, enforceRateLimit } from "@/server/ratelimit";
import { getAsset, readFile } from "@/server/storage";
import { verifyToken } from "@/server/tokens";

function gone(message: string, status = 404) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Link unavailable</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#222"><h1 style="font-size:1.25rem">Link unavailable</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/** Expiring, per-recipient download link for the update PDF or an attachment. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const fields = verifyToken("file", token, 3);
  if (!fields) return gone("This download link is invalid or has expired. Reply to the email to request a new copy.");
  try {
    await enforceRateLimit("publicLink", clientIp(req));
  } catch {
    return gone("Too many requests. Please try again in a few minutes.", 429);
  }
  const [campaignId, recipientId, fileKey] = fields;
  try {
    const [campaign, recipient] = await Promise.all([getCampaign(campaignId), recipientsCol(campaignId).doc(recipientId).get()]);
    if (!campaign || !recipient.exists || !campaign.approval) return gone("This document is no longer available.");
    let body: Buffer;
    let filename: string;
    let mime: string;
    if (fileKey === "update") {
      if (campaign.pdfDelivery === "none") return gone("This document is no longer available.");
      body = await readFile(snapshotPaths(campaignId).pdf);
      filename = pdfFilename(campaign.title);
      mime = "application/pdf";
    } else {
      const raw = await campaignsCol().doc(campaignId).get();
      const allowed = ((raw.get("attachments") as { id: string }[] | undefined) ?? []).some((a) => a.id === fileKey);
      if (!allowed) return gone("This document is no longer available.");
      const asset = await getAsset(fileKey);
      if (!asset || asset.kind !== "attachment") return gone("This document is no longer available.");
      body = await readFile(asset.storagePath);
      filename = asset.filename;
      mime = asset.mime;
    }
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `${mime === "application/pdf" ? "inline" : "attachment"}; filename="${filename.replace(/["\r\n\\]/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    log.error("download.failed", { err });
    return gone("Something went wrong. Please try again later.", 500);
  }
}
