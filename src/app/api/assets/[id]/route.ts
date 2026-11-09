import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";
import { getAsset, isStorageDisabledError, readFile, storageProblem } from "@/server/storage";
import { contentDisposition } from "@/server/http/content-disposition";
import { verifyToken } from "@/server/tokens";

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Images referenced by sent emails are "published" and served to anyone holding the
 * unguessable asset id (mail clients cannot authenticate). Unpublished images and all
 * attachments require an admin session or a short-lived preview token.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) return notFound();

  const isPublic = asset.published && asset.kind === "image";
  if (!isPublic) {
    const token = req.nextUrl.searchParams.get("t");
    const tokenOk = token ? verifyToken("asset", token, 1)?.[0] === id : false;
    const sessionOk = tokenOk ? true : !!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
    if (!tokenOk && !sessionOk) return notFound();
  }

  let body: Buffer;
  try {
    body = await readFile(asset.storagePath);
  } catch (err) {
    if (isStorageDisabledError(err) || (await storageProblem())) {
      return new Response("File storage is not available", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return notFound();
  }
  const headers: Record<string, string> = {
    "Content-Type": asset.mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, max-age=300",
  };
  if (asset.kind === "attachment") {
    headers["Content-Disposition"] = contentDisposition("attachment", asset.filename);
  }
  return new Response(new Uint8Array(body), { headers });
}
