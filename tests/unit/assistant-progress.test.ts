import { describe, expect, it } from "vitest";
import {
  clampLabel,
  describeHit,
  promptBlockIndex,
  ResponseScanner,
  sectionName,
  thoughtHeadlines,
  type ScanHit,
} from "../../src/lib/content/assistant-progress";
import type { DocNode } from "../../src/lib/content/schema";

const doc = (): DocNode =>
  ({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "TL;DR", marks: [{ type: "bold" }] }, { type: "text", text: " [Write: three facts]" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Commercial" }] },
      { type: "paragraph", content: [{ type: "text", text: "[Write: a claim] and [Write: a second claim]" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Lowlights" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Launch slipped" }] }] }] },
    ],
  }) as unknown as DocNode;

/** Feed `text` in fixed-size chunks and collect every hit. */
function scanInChunks(text: string, size: number): { hits: ScanHit[]; scanner: ResponseScanner } {
  const scanner = new ResponseScanner();
  const hits: ScanHit[] = [];
  for (let i = 0; i < text.length; i += size) hits.push(...scanner.push(text.slice(i, i + size)));
  return { hits, scanner };
}

describe("ResponseScanner", () => {
  const response = JSON.stringify({
    reply: 'Filled the TL;DR. Braces { and } and "quotes" in text don\'t count.',
    fills: [
      { id: 0, text: "We closed {two} contracts" },
      { id: 2, text: "Second \\ claim" },
    ],
    edits: [{ op: "replace", index: 4, type: "bullet_list", items: ["a } b", "c"] }],
  });

  it.each([1, 3, 17, response.length])("reports each object once with chunk size %i", (size) => {
    const { hits, scanner } = scanInChunks(response, size);
    expect(hits.map((h) => h.kind)).toEqual(["reply", "fill", "fill", "edit"]);
    expect(hits[1]).toEqual({ kind: "fill", value: { id: 0, text: "We closed {two} contracts" } });
    expect((hits[3] as { value: { items: string[] } }).value.items).toEqual(["a } b", "c"]);
    expect(scanner.text).toBe(response);
  });

  it("ignores nested objects outside fills and edits", () => {
    const { hits } = scanInChunks('{"reply":"ok","meta":[{"a":1}],"fills":[],"edits":[]}', 5);
    expect(hits).toEqual([{ kind: "reply" }]);
  });
});

describe("thoughtHeadlines", () => {
  it("returns complete bold headlines only", () => {
    expect(thoughtHeadlines("**Mapping notes to the TL;DR**\n\nI see three facts. **Checking the met")).toEqual([
      "Mapping notes to the TL;DR",
    ]);
  });
});

describe("labels", () => {
  it("names blocks by bold lead or the heading above", () => {
    expect(sectionName(doc(), 0)).toBe("TL;DR");
    expect(sectionName(doc(), 2)).toBe("Commercial");
    expect(sectionName(doc(), 4)).toBe("Lowlights");
  });

  it("maps prompt ids to their blocks", () => {
    expect([...promptBlockIndex(doc())]).toEqual([
      [0, 0],
      [1, 2],
      [2, 2],
    ]);
  });

  it("describes fills and edits", () => {
    const d = doc();
    const prompts = promptBlockIndex(d);
    expect(describeHit({ kind: "fill", value: { id: 0 } }, d, prompts)).toBe("Drafted TL;DR");
    expect(describeHit({ kind: "fill", value: { id: 99 } }, d, prompts)).toBeNull();
    expect(describeHit({ kind: "edit", value: { op: "replace", index: 4 } }, d, prompts)).toBe("Rewrote Lowlights");
    expect(describeHit({ kind: "edit", value: { op: "insert_after", index: 2 } }, d, prompts)).toBe("Added to Commercial");
    expect(describeHit({ kind: "edit", value: { op: "delete", index: 40 } }, d, prompts)).toBeNull();
  });

  it("keeps labels to one short line", () => {
    expect(clampLabel(`a\n${"x".repeat(200)}`).length).toBeLessThanOrEqual(72);
  });
});
