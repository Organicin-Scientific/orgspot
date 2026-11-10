import { describe, expect, it } from "vitest";
import { applyAssistantChanges, blockFromEdit, docOutline, parseInline } from "../../src/lib/content/assistant-edits";
import { listTemplatePrompts } from "../../src/lib/content/prompt-fills";
import { parseDoc, type DocNode } from "../../src/lib/content/schema";
import { starterDocument } from "../../src/lib/content/template";

const doc = (): DocNode => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Commercial" }] },
    { type: "paragraph", content: [{ type: "text", text: "Old text" }] },
    { type: "image", attrs: { assetId: "asset_123456", alt: "Trial site", align: "center" } },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Lowlights" }] },
  ],
});

const texts = (d: DocNode) => d.content.map((b) => b.type);

describe("assistant edits", () => {
  it("numbers top-level blocks and marks read-only ones", () => {
    const outline = docOutline(doc());
    expect(outline).toContain("[0] heading (level 2)");
    expect(outline).toContain("[1] paragraph\n    Old text");
    expect(outline).toContain("[2] image (read-only");
  });

  it("parses bold runs and line breaks", () => {
    expect(parseInline("**TL;DR** We closed Q1.\nNext line")).toEqual([
      { type: "text", text: "TL;DR", marks: [{ type: "bold" }] },
      { type: "text", text: " We closed Q1." },
      { type: "hardBreak" },
      { type: "text", text: "Next line" },
    ]);
  });

  it("applies replace, insert and delete by original index without shifting", () => {
    const result = applyAssistantChanges(doc(), new Map(), [
      { op: "insert_after", index: -1, type: "paragraph", text: "Top" },
      { op: "replace", index: 1, type: "paragraph", text: "New text" },
      { op: "insert_after", index: 1, type: "bullet_list", items: ["- One", "Two"] },
      { op: "delete", index: 3 },
    ]);
    expect(result.edited).toBe(4);
    expect(result.skipped).toBe(0);
    expect(texts(result.doc)).toEqual(["paragraph", "heading", "paragraph", "bulletList", "image"]);
    expect(JSON.stringify(result.doc)).toContain("New text");
    expect(JSON.stringify(result.doc)).toContain('"text":"One"');
    expect(parseDoc(result.doc).ok).toBe(true);
  });

  it("never replaces read-only blocks and skips bad indices", () => {
    const result = applyAssistantChanges(doc(), new Map(), [
      { op: "replace", index: 2, type: "paragraph", text: "Image gone" },
      { op: "replace", index: 99, type: "paragraph", text: "Nowhere" },
      { op: "insert_after", index: 0, type: "paragraph", text: "   " },
    ]);
    expect(result.edited).toBe(0);
    expect(result.skipped).toBe(3);
    expect(texts(result.doc)).toEqual(texts(doc()));
  });

  it("builds metrics from Label | sublabel | value lines", () => {
    const block = blockFromEdit({ op: "replace", index: 0, type: "metrics", items: ["Revenue | Q3 | $239K", "Contracts | 2"] });
    expect(block).toEqual({
      type: "metrics",
      attrs: {
        items: [
          { label: "Revenue", sublabel: "Q3", value: "$239K" },
          { label: "Contracts", sublabel: "", value: "2" },
        ],
      },
    });
  });

  it("fills template prompts and edits in one reply, and the result stays valid", () => {
    const starter = starterDocument();
    const before = listTemplatePrompts(starter).length;
    const result = applyAssistantChanges(starter, new Map([[0, "\"The marathon will humble you\" - Bill Rodgers"], [2, "$239K"]]), [
      { op: "insert_after", index: starter.content.length - 1, type: "paragraph", text: "**Thanks** to our advisors." },
    ]);
    expect(result.filled).toBe(2);
    expect(result.edited).toBe(1);
    expect(listTemplatePrompts(result.doc).length).toBe(before - 2);
    expect(parseDoc(result.doc).ok).toBe(true);
  });
});
