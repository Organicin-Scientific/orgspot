import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({
  env: () => ({
    AI_DRAFT_ENABLED: true,
    FIREBASE_PROJECT_ID: "demo-organicin",
    FIREBASE_CLIENT_EMAIL: "svc@example.com",
    FIREBASE_PRIVATE_KEY: "key",
  }),
}));
vi.mock("@/server/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let modelReply: unknown = {};
vi.mock("@google-cloud/vertexai", async (orig) => {
  const actual = await orig<typeof import("@google-cloud/vertexai")>();
  return {
    ...actual,
    VertexAI: class {
      getGenerativeModel() {
        return {
          generateContentStream: async () => ({
            stream: (async function* () {
              // Split the answer across chunks, as the streamed API does.
              const text = JSON.stringify(modelReply);
              const half = Math.floor(text.length / 2);
              for (const piece of [text.slice(0, half), text.slice(half)]) {
                yield { candidates: [{ content: { parts: [{ text: piece }] } }] };
              }
            })(),
          }),
        };
      }
    },
  };
});

const { runAssistantTurn } = await import("../../src/server/ai/assistant");
const { listTemplatePrompts } = await import("../../src/lib/content/prompt-fills");
const { starterDocument } = await import("../../src/lib/content/template");

const doc = starterDocument();
const ids = Object.fromEntries(listTemplatePrompts(doc).map((p) => [p.instruction.slice(0, 24), p.id]));
const id = (start: string) => {
  const key = Object.keys(ids).find((k) => k.startsWith(start));
  if (key === undefined) throw new Error(start);
  return ids[key]!;
};
const source = { kind: "text" as const, filename: "Organicin Q3 2026 Investor Update.docx", text: "..." };

describe("a drafting turn from a document", () => {
  beforeEach(() => {
    // Roughly what Gemini returned for the Q3 doc: most prompts filled, a few left behind.
    modelReply = {
      reply: "Drafted the update from your Q3 document.",
      fills: [
        { id: id("a one-line quote"), text: "The impediment to action advances action. - Marcus Aurelius" },
        { id: id("two or three sentences"), text: "We collected $122.3K in customer cash in Q3." },
        { id: id("open proposals"), text: "$234K" },
        { id: id("one full-sentence claim"), text: "We completed discovery on our second program." },
        { id: id("what slipped"), text: "Lab capacity fell behind." },
        { id: id("a risk investors"), text: "Leadership turnover at a partner slowed work." },
      ],
      removals: [id("product progress"), id("result with a number, f"), id("result with a number.")],
      edits: [],
      left_out: ["Financial note: Q2 recognized revenue was restated from $97.6K to $23.7K."],
    };
  });

  it("removes the optional prompt Gemini skipped and lists what's still open", async () => {
    const result = await runAssistantTurn({ doc, history: [], message: "draft", source });
    const text = JSON.stringify(result.content);
    expect(text).not.toContain("optional one-line");
    expect(text).not.toContain("result with a number");
    expect(text).not.toContain("Products");
    expect(result.removed).toBe(4);
    expect(result.reply).toContain("Not used from the attachment:\n- Financial note");
    // Two metric cards and the R&D name and body had nothing in the doc; they're named, not hidden.
    expect(result.reply).toContain("Still to fill:\n- Revenue YTD from Mercury");
    expect(result.remainingPrompts).toBe(listTemplatePrompts(result.content!).length);
  });

  it("keeps the optional prompt when the author is chatting without a document", async () => {
    modelReply = { reply: "The TL;DR is three sentences.", fills: [], removals: [], edits: [], left_out: [] };
    const result = await runAssistantTurn({ doc, history: [], message: "how long is the TL;DR?", source: null });
    expect(result.content).toBeNull();
    expect(result.reply).toBe("The TL;DR is three sentences.");
  });

  it("accepts an older-shaped reply with no removals or left_out", async () => {
    modelReply = { reply: "Filled the quote.", fills: [{ id: 0, text: "Quote - Name" }], edits: [] };
    const result = await runAssistantTurn({ doc, history: [], message: "add a quote", source: null });
    expect(result.filled).toBe(1);
    expect(JSON.stringify(result.content)).toContain("optional one-line");
  });
});

describe("Revenue YTD and the author's own placeholders", () => {
  const revenueCard = (d: unknown) => {
    const blocks = (d as { content: { type: string; attrs?: { items?: { label: string; value: string; chart?: unknown }[] } }[] }).content;
    return blocks.find((b) => b.type === "metrics")!.attrs!.items!.find((m) => m.label === "Revenue YTD")!;
  };

  it("builds the chart from monthly cash and derives the headline from it", async () => {
    modelReply = {
      reply: "Added the monthly cash.",
      fills: [],
      removals: [],
      edits: [],
      left_out: [],
      revenue_months: {
        year: 2026,
        months: [14600, 0, 700, 0, 24400, 0, 58300, 64000, 0, 21400].map((cash, i) => ({ month: i + 1, cash })),
      },
    };
    const result = await runAssistantTurn({ doc, history: [], message: "draft", source });
    const card = revenueCard(result.content);
    expect(card.chart).toEqual({ year: 2026, months: [14600, 0, 700, 0, 24400, 0, 58300, 64000, 0, 21400] });
    expect(card.value).toBe("$183K");
  });

  it("adds only the latest quarter to months already on the card", async () => {
    modelReply = {
      reply: "Added the monthly cash.",
      fills: [], removals: [], edits: [], left_out: [],
      revenue_months: { year: 2026, months: [{ month: 1, cash: 14600 }, { month: 2, cash: 0 }, { month: 3, cash: 700 }] },
    };
    const first = await runAssistantTurn({ doc, history: [], message: "q1", source: null });
    modelReply = {
      reply: "Added Q2.",
      fills: [], removals: [], edits: [], left_out: [],
      revenue_months: { year: 2026, months: [{ month: 4, cash: 0 }, { month: 5, cash: 24400 }, { month: 6, cash: 0 }] },
    };
    const second = await runAssistantTurn({ doc: first.content!, history: [], message: "q2", source: null });
    expect(revenueCard(second.content).chart).toEqual({ year: 2026, months: [14600, 0, 700, 0, 24400, 0] });
  });

  it("refuses a quarter that leaves a gap, and says which month is missing", async () => {
    modelReply = {
      reply: "Added Q3.",
      fills: [], removals: [], edits: [], left_out: [],
      revenue_months: { year: 2026, months: [{ month: 7, cash: 58300 }] },
    };
    const result = await runAssistantTurn({ doc, history: [], message: "q3", source: null });
    expect(result.content).toBeNull();
    expect(result.reply).toContain("needs January 2026");
  });

  it("won't put a typed value on the Revenue YTD card", async () => {
    modelReply = { reply: "Filled revenue.", fills: [{ id: id("Revenue YTD from Mercury"), text: "$183K" }], removals: [], edits: [], left_out: [] };
    const result = await runAssistantTurn({ doc, history: [], message: "revenue is $183K", source: null });
    expect(revenueCard(result.content ?? doc).value).toContain("[Write:");
  });

  it("keeps a placeholder copied from the author's material and drops one it invented", async () => {
    modelReply = {
      reply: "Drafted Lowlights.",
      fills: [
        { id: id("what slipped"), text: "Testing slowed turnaround by [Write: weeks]. We expect to clear it by [Write: month]." },
        { id: id("a risk investors"), text: "A partner changed leadership. [Write: invented by the model]" },
      ],
      removals: [], edits: [], left_out: [],
    };
    const result = await runAssistantTurn({
      doc,
      history: [],
      message: "draft",
      source: { kind: "text", filename: "draft.md", text: "slowed turnaround by [Write: weeks] ... clear by [Write: month]" },
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain("[Write: weeks]");
    expect(text).toContain("[Write: month]");
    expect(text).not.toContain("invented by the model");
  });
});
