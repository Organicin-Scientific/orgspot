import { audit } from "@/server/audit";
import { badRequest } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";
import { getAssets, uploadAttachment, uploadImage } from "@/server/storage";

export const GET = withAdmin(async ({ req }) => {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .filter((id) => /^[A-Za-z0-9_-]{6,64}$/.test(id))
    .slice(0, 20);
  const assets = await getAssets(ids);
  return ok(
    assets.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, mime: a.mime, size: a.size, published: a.published, createdAt: a.createdAt })),
  );
});

export const POST = withAdmin(
  async ({ req, session }) => {
    if (Number(req.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) throw badRequest("File is too large");
    const form = await req.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File)) throw badRequest("Choose a file to upload");
    const asset = kind === "attachment" ? await uploadAttachment(file, session.email) : await uploadImage(file, session.email);
    await audit({
      actorEmail: session.email,
      action: "asset.upload",
      resourceType: "asset",
      resourceId: asset.id,
      summary: `Uploaded ${asset.kind} (${Math.round(asset.size / 1024)} KB)`,
    });
    return ok(asset, { status: 201 });
  },
  { rateLimit: "upload" },
);
