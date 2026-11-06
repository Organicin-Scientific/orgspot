import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { AssetMeta } from "@/lib/types";
import { env } from "./env";
import { bucket, db } from "./firebase-admin";
import { badRequest } from "./http/errors";
import { chunk, data, isoRequired, num, str } from "./db/convert";

export const assetsCol = () => db().collection("assets");

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", magic: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8") },
  "image/webp": {
    ext: "webp",
    magic: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Random, unguessable asset id (also used as the public image path once published). */
export function newAssetId(): string {
  return randomBytes(15).toString("base64url");
}

export function detectImageType(buf: Buffer, declared: string): string | null {
  const t = IMAGE_TYPES[declared];
  if (t && t.magic(buf)) return declared;
  for (const [mime, info] of Object.entries(IMAGE_TYPES)) if (info.magic(buf)) return mime;
  return null;
}

export async function uploadImage(file: File, actor: string): Promise<AssetMeta> {
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_IMAGE_BYTES) throw badRequest("Images must be 5 MB or smaller");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = detectImageType(buf, file.type);
  if (!mime) throw badRequest("Only PNG, JPEG, GIF and WebP images are supported");
  const id = newAssetId();
  const path = `assets/${id}.${IMAGE_TYPES[mime].ext}`;
  await bucket().file(path).save(buf, {
    contentType: mime,
    resumable: false,
    metadata: { cacheControl: "private, max-age=0" },
  });
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "image";
  await assetsCol().doc(id).create({
    kind: "image",
    filename,
    mime,
    size: buf.length,
    storagePath: path,
    sha256: createHash("sha256").update(buf).digest("hex"),
    published: false,
    createdBy: actor,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id, kind: "image", filename, mime, size: buf.length, published: false, createdAt: new Date().toISOString() };
}

const ATTACHMENT_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "application/pdf": { ext: "pdf", magic: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", magic: isZip },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", magic: isZip },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", magic: isZip },
};
function isZip(b: Buffer) {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Supporting documents are never attached directly; recipients get expiring signed links. */
export async function uploadAttachment(file: File, actor: string): Promise<AssetMeta> {
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_ATTACHMENT_BYTES) throw badRequest("Documents must be 20 MB or smaller");
  const type = ATTACHMENT_TYPES[file.type];
  const buf = Buffer.from(await file.arrayBuffer());
  if (!type || !type.magic(buf)) throw badRequest("Only PDF, DOCX, XLSX and PPTX documents are supported");
  const id = newAssetId();
  const path = `attachments/${id}.${type.ext}`;
  await bucket().file(path).save(buf, { contentType: file.type, resumable: false });
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `document.${type.ext}`;
  await assetsCol().doc(id).create({
    kind: "attachment",
    filename,
    mime: file.type,
    size: buf.length,
    storagePath: path,
    sha256: createHash("sha256").update(buf).digest("hex"),
    published: false,
    createdBy: actor,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id, kind: "attachment", filename, mime: file.type, size: buf.length, published: false, createdAt: new Date().toISOString() };
}

export async function getAssets(ids: string[]): Promise<StoredAsset[]> {
  const out: StoredAsset[] = [];
  for (const id of ids) {
    const a = await getAsset(id);
    if (a) out.push(a);
  }
  return out;
}

export interface StoredAsset extends AssetMeta {
  storagePath: string;
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  const snap = await assetsCol().doc(id).get();
  if (!snap.exists) return null;
  const d = data(snap);
  return {
    id: snap.id,
    kind: d.kind as AssetMeta["kind"],
    filename: str(d.filename),
    mime: str(d.mime),
    size: num(d.size),
    published: d.published === true,
    createdAt: isoRequired(d.createdAt),
    storagePath: str(d.storagePath),
  };
}

export async function readFile(path: string): Promise<Buffer> {
  const [buf] = await bucket().file(path).download();
  return buf;
}

export async function writeFile(path: string, content: Buffer | string, contentType: string) {
  await bucket().file(path).save(typeof content === "string" ? Buffer.from(content, "utf8") : content, {
    contentType,
    resumable: false,
    metadata: { cacheControl: "private, max-age=0" },
  });
}

/**
 * Images must be reachable by recipients' mail clients. Only images referenced by a test
 * send or an approved campaign are marked published; everything else stays private.
 */
export async function publishAssets(ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  for (const part of chunk(unique, 400)) {
    const batch = db().batch();
    const snaps = await db().getAll(...part.map((id) => assetsCol().doc(id)));
    for (const s of snaps) {
      if (s.exists && s.data()?.published !== true) {
        batch.update(s.ref, { published: true, publishedAt: FieldValue.serverTimestamp() });
      }
    }
    await batch.commit();
  }
}

export async function loadAssetBuffers(ids: string[]): Promise<Map<string, { buf: Buffer; mime: string }>> {
  const out = new Map<string, { buf: Buffer; mime: string }>();
  for (const id of [...new Set(ids)]) {
    const meta = await getAsset(id);
    if (!meta || meta.kind !== "image") continue;
    try {
      out.set(id, { buf: await readFile(meta.storagePath), mime: meta.mime });
    } catch {
      // Missing object: renderers fall back to alt text.
    }
  }
  return out;
}

export function assetUrl(id: string): string {
  return `${env().APP_URL}/api/assets/${id}`;
}
