import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/lib/content/schema";
import { OPTIONAL_SECTIONS, starterDocument } from "../../src/lib/content/template";

describe("template documents", () => {
  it("starterDocument passes parseDoc", () => {
    const r = parseDoc(starterDocument());
    expect(r.ok).toBe(true);
  });

  it("every OPTIONAL_SECTIONS blocks array wrapped in a doc passes parseDoc", () => {
    for (const section of OPTIONAL_SECTIONS) {
      const r = parseDoc({ type: "doc", content: section.blocks });
      expect(r.ok, `section ${section.id} should parse`).toBe(true);
    }
  });
});

describe("template prompts", () => {
  it("the starter document is full of prompts, so it cannot be sent as is", async () => {
    const { templatePromptCount } = await import("../../src/lib/content/template");
    expect(templatePromptCount(starterDocument())).toBeGreaterThan(10);
  });

  it("counts prompts in text and in metric values, and none once filled", async () => {
    const { templatePromptCount, PROMPT_OPEN } = await import("../../src/lib/content/template");
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `${PROMPT_OPEN}something]` }] },
        { type: "metrics", attrs: { items: [{ label: "Revenue", sublabel: "", value: `${PROMPT_OPEN}$]` }] } },
      ],
    };
    expect(templatePromptCount(doc)).toBe(2);
    expect(templatePromptCount({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Revenue grew." }] }] })).toBe(0);
  });

  it("opens with the current company description and the 2026 section order", () => {
    const doc = starterDocument();
    const text = JSON.stringify(doc);
    expect(text).toContain("to prevent disease and improve microbiome health");
    const headings = doc.content.filter((b) => b.type === "heading").map((b) => (b as { content: { text: string }[] }).content[0].text);
    expect(headings).toEqual(["Commercial", "R&D & Technology", "Lowlights"]);
  });
});
