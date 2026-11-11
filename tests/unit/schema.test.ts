import { describe, expect, it } from "vitest";
import { collectAssetIds, isSafeHref, MAX_DOC_BYTES, parseDoc, type DocNode } from "../../src/lib/content/schema";

describe("isSafeHref", () => {
  it("accepts http, https, and mailto", () => {
    expect(isSafeHref("https://example.com/path")).toBe(true);
    expect(isSafeHref("http://localhost:3000/")).toBe(true);
    expect(isSafeHref("http://example.com/")).toBe(false);
    expect(isSafeHref("mailto:a@b.co")).toBe(true);
  });

  it("rejects javascript: and data: URLs", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });
});

describe("parseDoc", () => {
  const validDoc: unknown = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "left" },
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world", marks: [{ type: "bold" }] },
          { type: "text", text: " italic", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: " link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2, textAlign: null },
        content: [{ type: "text", text: "Section" }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "First item" }],
              },
            ],
          },
        ],
      },
      {
        type: "metrics",
        attrs: {
          items: [
            { label: "Revenue", sublabel: "YoY", value: "$1M" },
            { label: "Burn", sublabel: "", value: "$0" },
          ],
        },
      },
      {
        type: "image",
        attrs: { assetId: "abcdef123", alt: "Chart", align: "center" },
      },
      {
        type: "callout",
        attrs: { tone: "info" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Note text" }],
          },
        ],
      },
      {
        type: "pullQuote",
        content: [{ type: "text", text: "Quoted" }],
      },
      { type: "horizontalRule", attrs: { variant: "short" } },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "A1" }],
                  },
                ],
              },
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "B1" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("parses a rich valid document", () => {
    const r = parseDoc(validDoc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.type).toBe("doc");
  });

  it("rejects link href javascript:", () => {
    const bad = structuredClone(validDoc) as { content: unknown[] };
    const para = bad.content[0] as {
      content: Array<{ marks?: unknown[]; type: string; text?: string }>;
    };
    para.content.push({
      type: "text",
      text: "bad",
      marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
    });
    const r = parseDoc(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects data: href", () => {
    const bad = structuredClone(validDoc) as { content: unknown[] };
    const para = bad.content[0] as {
      content: Array<{ marks?: unknown[]; type: string; text?: string }>;
    };
    para.content.push({
      type: "text",
      text: "bad",
      marks: [{ type: "link", attrs: { href: "data:text/html,xxx" } }],
    });
    const r = parseDoc(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown node types script and iframe", () => {
    expect(parseDoc({ type: "doc", content: [{ type: "script", content: [] }] }).ok).toBe(false);
    expect(parseDoc({ type: "doc", content: [{ type: "iframe", attrs: {} }] }).ok).toBe(false);
  });

  it("strips unknown attributes on paragraph (e.g. onclick)", () => {
    const r = parseDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)", textAlign: "center" },
          content: [{ type: "text", text: "Hi" }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const para = r.doc.content[0];
      expect(para.type).toBe("paragraph");
      expect(JSON.stringify(para).includes("onclick")).toBe(false);
    }
  });

  it("nullifies invalid textStyle color payloads", () => {
    const r = parseDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                {
                  type: "textStyle",
                  attrs: { color: "red;background:url(x)" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const mark = (r.doc.content[0] as { content?: { marks?: { attrs?: { color?: unknown } }[] }[] }).content?.[0]
        ?.marks?.[0];
      expect((mark as { type: string; attrs?: { color: unknown } })?.attrs?.color ?? null).toBeNull();
    }
  });

  it("rejects image assetId that does not match SAFE_ID", () => {
    const r = parseDoc({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { assetId: "../../etc", alt: "" },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects oversized JSON (> MAX_DOC_BYTES)", () => {
    const padding = "x".repeat(MAX_DOC_BYTES);
    const r = parseDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: padding }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i);
  });

  it("rejects deeply nested blockquotes (depth > 12)", () => {
    let inner: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "bottom" }],
    };
    for (let i = 0; i < 13; i++) {
      inner = { type: "blockquote", content: [inner] };
    }
    const r = parseDoc({ type: "doc", content: [inner] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nested/i);
  });

  it("normalizes empty doc content to a single empty paragraph", () => {
    const r = parseDoc({ type: "doc", content: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.content).toEqual([{ type: "paragraph" }]);
    }
  });
});

describe("collectAssetIds", () => {
  it("collects ids from images in callouts and table cells, deduplicated", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { tone: "note" },
          content: [
            {
              type: "image",
              attrs: { assetId: "assetOne12", alt: "", align: "center" },
            },
            {
              type: "image",
              attrs: { assetId: "assetOne12", alt: "dup", align: "center" },
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "image",
                      attrs: { assetId: "cellAsset9", alt: "", align: "center" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(collectAssetIds(doc).sort()).toEqual(["assetOne12", "cellAsset9"].sort());
  });
});
