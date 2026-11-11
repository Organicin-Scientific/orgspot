import "server-only";
import mammoth from "mammoth";
import { badRequest } from "../http/errors";

const MAX_EXTRACTED_CHARS = 400_000;
/** Vercel functions accept request bodies up to 4.5 MB, including the editor content. */
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type SourceAttachment =
  | { kind: "pdf"; mimeType: "application/pdf"; base64: string; filename: string }
  | { kind: "text"; text: string; filename: string };

export async function sourceFromUpload(file: File): Promise<SourceAttachment | null> {
  const name = file.name || "upload";
  const mime = (file.type || "").toLowerCase();
  const lower = name.toLowerCase();

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw badRequest("Documents must be 4 MB or smaller.");
    return { kind: "pdf", mimeType: "application/pdf", base64: buf.toString("base64"), filename: name };
  }

  if (mime === DOCX_MIME || lower.endsWith(".docx")) {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw badRequest("Documents must be 4 MB or smaller.");
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = truncateSource(result.value);
    if (!text.trim()) throw badRequest("Could not extract text from that Word document.");
    return { kind: "text", text, filename: name };
  }

  if (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    const text = truncateSource(await file.text());
    if (!text.trim()) throw badRequest("That text file is empty.");
    return { kind: "text", text, filename: name };
  }

  throw badRequest("Attach a PDF, Word (.docx), Markdown (.md) or text file.");
}

export function truncateSource(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return text.slice(0, MAX_EXTRACTED_CHARS);
}

export function truncateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= 80_000) return trimmed;
  return trimmed.slice(0, 80_000);
}
