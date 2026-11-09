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
