/**
 * Build a Content-Disposition header that is safe for any uploaded filename.
 *
 * HTTP header values must be Latin-1. A filename such as "Q3 Update – Final.pdf" (en dash)
 * makes `new Response()` throw, so the download fails with a 500. The ASCII `filename`
 * keeps old clients working and RFC 6266 / RFC 5987 `filename*` carries the real name.
 */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const clean = filename.replace(/[\r\n"\\]/g, "").trim() || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
