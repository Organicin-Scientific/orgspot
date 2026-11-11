import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/lib/content/schema";
import {
  countPromptMarkers,
  isStandingMetrics,
  OPTIONAL_SECTIONS,
  PROMPT_OPEN,
  STANDING_METRICS,
  starterDocument,
  templatePromptCount,
} from "../../src/lib/content/template";

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
  it("the starter document is full of prompts, so it cannot be sent as is", () => {
    expect(templatePromptCount(starterDocument())).toBeGreaterThan(10);
  });

  it("counts prompts in text and in metric values, and none once filled", () => {
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

  it("does not count prompts embedded only in unrelated JSON keys", () => {
    const sneaky = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "All done." }] }],
      _comment: `${PROMPT_OPEN}ignored]`,
    };
    expect(templatePromptCount(sneaky)).toBe(0);
  });

  it("countPromptMarkers matches indexOf behaviour", () => {
    expect(countPromptMarkers("")).toBe(0);
    expect(countPromptMarkers(`${PROMPT_OPEN}a] ${PROMPT_OPEN}b]`)).toBe(2);
  });

  it("carries the three standing metrics with their measurement basis", () => {
    const metrics = starterDocument().content.find((b) => b.type === "metrics") as
      | { attrs: { items: { label: string; sublabel: string }[] } }
      | undefined;
    expect(metrics?.attrs.items.map((i) => [i.label, i.sublabel])).toEqual([
      ["Revenue YTD", "cash received since Jan 1"],
      ["Contracted backlog", "signed, not yet collected"],
      ["Pipeline", "proposed, not yet signed"],
    ]);
  });

  it("recognises the standing strip and rejects renamed, missing or extra cards", () => {
    const std = STANDING_METRICS.map((m) => ({ ...m, value: "$1" }));
    expect(isStandingMetrics(std)).toBe(true);
    expect(isStandingMetrics(std.slice(0, 2))).toBe(false);
    expect(isStandingMetrics([...std, { label: "Runway", sublabel: "", value: "" }])).toBe(false);
    expect(isStandingMetrics(std.map((m, i) => (i === 2 ? { ...m, label: "Pipeline (2Q)" } : m)))).toBe(false);
  });

  it("opens with the current company description and the 2026 section order", () => {
    const doc = starterDocument();
    const text = JSON.stringify(doc);
    expect(text).toContain("to prevent disease and improve microbiome health");
    const headings = doc.content.filter((b) => b.type === "heading").map((b) => (b as { content: { text: string }[] }).content[0].text);
    expect(headings).toEqual(["Commercial", "R&D & Technology", "Lowlights"]);
  });
});
