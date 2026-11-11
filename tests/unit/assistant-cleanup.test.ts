import { describe, expect, it } from "vitest";
import { applyAssistantChanges } from "../../src/lib/content/assistant-edits";
import { applyPromptFills, listTemplatePrompts, stripPromptMarkers } from "../../src/lib/content/prompt-fills";
import { parseDoc, type DocNode } from "../../src/lib/content/schema";
import { OPTIONAL_SECTIONS, starterDocument, templatePromptCount } from "../../src/lib/content/template";

const json = (doc: unknown) => JSON.stringify(doc);
const idOf = (doc: DocNode, match: string) => {
  const p = listTemplatePrompts(doc).find((x) => x.instruction.includes(match));
  if (!p) throw new Error(`no prompt matching ${match}`);
  return p.id;
};

describe("removing prompts the material doesn't support", () => {
  it("marks the template's optional prompts", () => {
    const optional = listTemplatePrompts(starterDocument()).filter((p) => p.optional);
    expect(optional.map((p) => p.instruction)).toEqual([expect.stringMatching(/^optional one-line summing up/)]);
  });

  it("drops the optional summing-up paragraph entirely", () => {
    const doc = starterDocument();
    const { doc: next, removed } = applyPromptFills(doc, new Map(), new Set([idOf(doc, "optional one-line")]));
    expect(removed).toBe(1);
    expect(json(next)).not.toContain("optional one-line");
    expect(next.content.length).toBe(doc.content.length - 1);
    expect(parseDoc(next).ok).toBe(true);
  });

  it("drops an empty bullet but keeps its filled sibling", () => {
    const doc = starterDocument();
    const fills = new Map([[idOf(doc, "result with a number, for example"), "Cost per candidate fell 10x."]]);
    const removals = new Set([idOf(doc, "result with a number.")]);
    const { doc: next } = applyPromptFills(doc, fills, removals);
    const lists = next.content.filter((b) => b.type === "bulletList");
    const rd = lists.find((l) => json(l).includes("Cost per candidate fell 10x."));
    expect(rd && rd.type === "bulletList" ? rd.content.length : 0).toBe(1);
    expect(json(next)).not.toContain("result with a number.");
  });

  it("drops a whole list and its bold sub-label when every bullet goes", () => {
    const doc = starterDocument();
    const removals = new Set([idOf(doc, "product progress")]);
    const { doc: next } = applyPromptFills(doc, new Map(), removals);
    expect(json(next)).not.toContain("Products");
    expect(json(next)).toContain("Research collaborations");
    expect(parseDoc(next).ok).toBe(true);
  });

  it("drops a lead-in like 'Cost per candidate:' when its figure is removed", () => {
    const section = OPTIONAL_SECTIONS.find((s) => s.id === "platform-metrics")!;
    const doc: DocNode = { type: "doc", content: section.blocks };
    const prompts = listTemplatePrompts(doc);
    const keep = prompts[2]!.id;
    const removals = new Set(prompts.filter((p) => p.id !== keep).map((p) => p.id));
    const { doc: next } = applyPromptFills(doc, new Map([[keep, "150+"]]), removals);
    const text = json(next);
    expect(text).not.toContain("Cost per candidate");
    expect(text).not.toContain("Time to candidate");
    expect(text).toContain("150+");
  });

  it("removes a metric card and keeps the others", () => {
    const doc = starterDocument();
    const fills = new Map([[idOf(doc, "open proposals"), "$234K"]]);
    const removals = new Set([idOf(doc, "uncollected contract value")]);
    const { doc: next, remainingPrompts } = applyPromptFills(doc, fills, removals);
    const metrics = next.content.find((b) => b.type === "metrics");
    expect(metrics?.type === "metrics" && metrics.attrs.items.map((m) => m.label)).toEqual(["Revenue YTD", "Pipeline"]);
    expect(remainingPrompts).toBe(templatePromptCount(doc) - 2);
  });

  it("drops the metrics strip when every card is removed", () => {
    const doc = starterDocument();
    const metricIds = listTemplatePrompts(doc).filter((p) => p.kind === "metric").map((p) => p.id);
    const { doc: next } = applyPromptFills(doc, new Map(), new Set(metricIds));
    expect(next.content.some((b) => b.type === "metrics")).toBe(false);
  });

  it("a fill wins over a removal for the same prompt", () => {
    const doc = starterDocument();
    const id = idOf(doc, "optional one-line");
    const { doc: next, filled, removed } = applyPromptFills(doc, new Map([[id, "Two paying partners."]]), new Set([id]));
    expect([filled, removed]).toEqual([1, 0]);
    expect(json(next)).toContain("Two paying partners.");
  });

  it("leaves untouched empty paragraphs alone", () => {
    const doc: DocNode = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "[Write: optional x]" }] }] };
    const { doc: next } = applyPromptFills(doc, new Map(), new Set([0]));
    expect(next.content).toEqual([{ type: "paragraph" }]);
  });
});

describe("assistant edits can't add leftovers", () => {
  it("strips placeholders the model writes itself", () => {
    expect(stripPromptMarkers("Signed $239K. [Write: add the date]")).toBe("Signed $239K.");
    const doc = starterDocument();
    const lowlights = doc.content.length - 1;
    const result = applyAssistantChanges(doc, new Map(), [
      { op: "replace", index: lowlights, type: "bullet_list", items: ["Lab capacity slipped.", "[Write: second lowlight]"] },
    ]);
    const last = result.doc.content[result.doc.content.length - 1]!;
    expect(last.type === "bulletList" && last.content.length).toBe(1);
    expect(json(last)).not.toContain("[Write:");
  });

  it("keeps metric labels when the model rewrites the strip", () => {
    const doc = starterDocument();
    const index = doc.content.findIndex((b) => b.type === "metrics");
    // What happened on the Q3 draft: the model renamed the cards and typed new placeholders.
    const result = applyAssistantChanges(doc, new Map(), [
      {
        op: "replace",
        index,
        type: "metrics",
        items: ["Revenue this quarter | $122.3K", "Contracts signed | [Write: contract value]", "Pipeline | next two quarters | $234K"],
      },
    ]);
    const metrics = result.doc.content[index]!;
    expect(metrics.type).toBe("metrics");
    if (metrics.type !== "metrics") return;
    expect(metrics.attrs.items.map((m) => m.label)).toEqual(["Revenue YTD", "Contracted backlog", "Pipeline"]);
    expect(metrics.attrs.items.map((m) => m.value)).toEqual(["$122.3K", "[Write: uncollected contract value]", "$234K"]);
  });

  it("refuses a new metrics strip and won't turn another block into one", () => {
    const doc = starterDocument();
    const before = json(doc);
    const result = applyAssistantChanges(doc, new Map(), [
      { op: "insert_after", index: 2, type: "metrics", items: ["Cash | $1"] },
      { op: "replace", index: 2, type: "metrics", items: ["Cash | $1"] },
    ]);
    expect(result.edited).toBe(0);
    expect(result.skipped).toBe(2);
    expect(json(result.doc)).toBe(before);
  });

  it("passes removals through and counts them", () => {
    const doc = starterDocument();
    const result = applyAssistantChanges(doc, new Map(), [], new Set([idOf(doc, "optional one-line")]));
    expect(result.removed).toBe(1);
    expect(parseDoc(result.doc).ok).toBe(true);
  });
});
