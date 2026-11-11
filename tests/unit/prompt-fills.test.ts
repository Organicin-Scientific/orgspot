import { describe, expect, it } from "vitest";
import { applyPromptFills, listTemplatePrompts } from "../../src/lib/content/prompt-fills";
import { parseDoc } from "../../src/lib/content/schema";
import { PROMPT_OPEN, starterDocument, templatePromptCount } from "../../src/lib/content/template";

describe("prompt fills", () => {
  it("lists prompts in document order including metrics", () => {
    const doc = starterDocument();
    const listed = listTemplatePrompts(doc);
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.some((p) => p.kind === "metric")).toBe(true);
  });

  it("applies fills by id and clears italic on filled text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `${PROMPT_OPEN}one]`, marks: [{ type: "italic" }] }],
        },
        {
          type: "metrics",
          attrs: {
            items: [{ label: "Revenue", sublabel: "", value: `${PROMPT_OPEN}$1M]` }],
          },
        },
      ],
    };
    const fills = new Map<number, string>([
      [0, "Revenue grew sharply."],
      [1, "$1.2M"],
    ]);
    const { doc: next, filled, remainingPrompts } = applyPromptFills(doc as never, fills);
    expect(filled).toBe(2);
    expect(remainingPrompts).toBe(0);
    const parsed = parseDoc(next);
    expect(parsed.ok).toBe(true);
    const text = JSON.stringify(next);
    expect(text).toContain("Revenue grew sharply.");
    expect(text).toContain("$1.2M");
    expect(text).not.toContain(PROMPT_OPEN);
  });

  it("leaves unknown ids as prompts", () => {
    const before = templatePromptCount(starterDocument());
    const { remainingPrompts } = applyPromptFills(starterDocument(), new Map([[0, "Filled quote."]]));
    expect(remainingPrompts).toBe(before - 1);
  });
});

describe("bold and kept placeholders in fills", () => {
  it("turns **bold** in a fill into a bold run", async () => {
    const { applyPromptFills } = await import("../../src/lib/content/prompt-fills");
    const d = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "[Write: program]", marks: [{ type: "italic" }] }] }] } as never;
    const out = applyPromptFills(d, new Map([[0, "**CinThesis (Enteron)** shipped."]]));
    expect((out.doc.content[0] as { content: unknown[] }).content).toEqual([
      { type: "text", text: "CinThesis (Enteron)", marks: [{ type: "bold" }] },
      { type: "text", text: " shipped." },
    ]);
  });

  it("strips invented placeholders but keeps the author's", async () => {
    const { stripPromptMarkers, promptKeysIn } = await import("../../src/lib/content/prompt-fills");
    const keep = promptKeysIn("turnaround by [Write: weeks]");
    expect(stripPromptMarkers("Slowed by [Write: weeks]. Done [Write: other] .", keep)).toBe("Slowed by [Write: weeks]. Done.");
  });
});
