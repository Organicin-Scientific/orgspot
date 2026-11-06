import type { BlockNode, DocNode } from "./schema";

const t = (text: string, marks?: ("bold" | "italic")[]) => ({
  type: "text" as const,
  text,
  ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}),
});

const p = (...content: ReturnType<typeof t>[]): BlockNode => ({ type: "paragraph", content });
const h = (text: string, level: 1 | 2 | 3 = 2): BlockNode => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const item = (lead: string, rest: string) => ({
  type: "listItem" as const,
  content: [p(t(lead, ["bold"]), t(` ${rest}`))],
});

/**
 * Starter document mirroring the structure of past investor updates.
 * All text and numbers are synthetic placeholders and must be replaced before sending.
 */
export function starterDocument(): DocNode {
  return {
    type: "doc",
    content: [
      { type: "pullQuote", content: [t("Add an opening quote or a one-line theme for this update.")] },
      { type: "horizontalRule", attrs: { variant: "short" } },
      p(
        t("What do we do?", ["bold"]),
        t(" Replace this with a two-sentence description of the company for readers who are new to the business."),
      ),
      { type: "horizontalRule", attrs: { variant: "short" } },
      {
        type: "metrics",
        attrs: {
          items: [
            { label: "Metric one", sublabel: "", value: "$0.0K" },
            { label: "Metric two", sublabel: "", value: "$0.0K" },
            { label: "Metric three", sublabel: "Comparison period", value: "+0%" },
          ],
        },
      },
      h("Highlights"),
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          item("Lead with the headline.", "Follow with one or two sentences of supporting context."),
          item("Second highlight.", "Explain what changed and why it matters."),
          item("Third highlight.", "Note any next steps or expected timing."),
        ],
      },
      h("Lowlights"),
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          item("Be candid about setbacks.", "Describe the issue and how the team is responding."),
          item("Second lowlight.", "Keep it brief and factual."),
        ],
      },
    ],
  };
}

/** Optional sections offered from the editor's insert menu. */
export const OPTIONAL_SECTIONS: { id: string; label: string; blocks: BlockNode[] }[] = [
  {
    id: "scientific",
    label: "Scientific developments",
    blocks: [h("Scientific developments"), p(t("Summarise research progress at a level suitable for investors."))],
  },
  {
    id: "commercial",
    label: "Commercial developments",
    blocks: [h("Commercial developments"), p(t("Summarise partnerships, contracts and pipeline changes."))],
  },
  {
    id: "financial",
    label: "Financial update",
    blocks: [h("Financial update"), p(t("Summarise revenue, burn and runway using approved figures only."))],
  },
  {
    id: "milestones",
    label: "Milestones",
    blocks: [
      h("Milestones"),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p(t("Upcoming milestone and target timing."))] },
          { type: "listItem", content: [p(t("Upcoming milestone and target timing."))] },
        ],
      },
    ],
  },
  {
    id: "closing",
    label: "Closing message",
    blocks: [h("Closing"), p(t("Thank investors and note how to get in touch with questions."))],
  },
];
