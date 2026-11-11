import { chartTotal, formatShortUsd, hasChartData, REVENUE_YTD_LABEL } from "./revenue-chart";
import type { BlockNode, DocNode, MetricItem } from "./schema";

/**
 * Starter document for a quarterly investor update, built on the structure and voice of
 * Organicin's 2026 quarterly emails: quote, "What do we do?", TL;DR, Commercial, R&D &
 * Technology, Lowlights.
 *
 * Every placeholder is a writing prompt wrapped in PROMPT_OPEN … "]". Campaign preparation
 * refuses to send while any prompt remains (see `templatePromptCount`), so a half-filled
 * template can be previewed and test-sent but never reach investors.
 *
 * The repository is public, so prompts carry structure and style only, never figures,
 * customer names or other confidential detail.
 */

export const PROMPT_OPEN = "[Write: ";

type Mark = "bold" | "italic";
const t = (text: string, marks?: Mark[]) => ({
  type: "text" as const,
  text,
  ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}),
});
const prompt = (text: string) => t(`${PROMPT_OPEN}${text}]`, ["italic"]);

const p = (...content: ReturnType<typeof t>[]): BlockNode => ({ type: "paragraph", content });
const h = (text: string, level: 1 | 2 | 3 = 2): BlockNode => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const bullets = (...items: ReturnType<typeof t>[][]): BlockNode => ({
  type: "bulletList",
  content: items.map((content) => ({ type: "listItem" as const, content: [p(...content)] })),
});

/** The company description that opens every update. Public marketing copy. */
export const WHAT_WE_DO =
  " Organicin Scientific discovers and develops bacteriocins (antimicrobial proteins that inhibit specific pathogens) to prevent disease and improve microbiome health.";

/**
 * The standing metrics strip. Labels and basis lines are fixed so investors can compare
 * quarters; only values change. Every dollar sits in exactly one card: it moves from
 * Pipeline to Contracted backlog when a contract is signed, then to Revenue YTD when cash arrives.
 */
export const STANDING_METRICS: readonly { label: string; sublabel: string }[] = [
  { label: "Revenue YTD", sublabel: "cash received since Jan 1" },
  { label: "Contracted backlog", sublabel: "signed, not yet collected" },
  { label: "Pipeline", sublabel: "proposed, not yet signed" },
];

/** True when a strip carries exactly the standing labels, in order. */
export function isStandingMetrics(items: readonly { label: string; sublabel: string }[]): boolean {
  return (
    items.length === STANDING_METRICS.length &&
    items.every((it, i) => it.label === STANDING_METRICS[i].label && it.sublabel === STANDING_METRICS[i].sublabel)
  );
}

/** Writing prompts for each card's value, in STANDING_METRICS order. */
export const METRIC_PROMPTS = ["Revenue YTD from Mercury", "uncollected contract value", "open proposals"];

/** A fresh standing strip whose values are all prompts, so it blocks investor sends until filled. */
export function standingPromptItems(): MetricItem[] {
  return STANDING_METRICS.map((m, i) => ({ ...m, value: `${PROMPT_OPEN}${METRIC_PROMPTS[i]}]` }));
}

/**
 * Card labels from the strip used before November 2026. A draft still carrying any of them
 * gets the standing strip with fresh prompts; the old values measured different things, so
 * none carry over.
 */
const LEGACY_LABELS = new Set(["Revenue this quarter", "Contracts signed", "Pipeline / next two quarters"]);

function isLegacyStrip(items: readonly { label: string; sublabel: string }[]): boolean {
  return items.some(
    (it) => LEGACY_LABELS.has(it.label.trim()) || (it.label.trim() === "Pipeline" && /next two quarters/i.test(it.sublabel)),
  );
}

/** Replace any legacy metrics strip with the standing strip and its prompts. Returns the same doc when nothing changes. */
export function migrateLegacyMetrics(doc: DocNode): DocNode {
  let changed = false;
  const walk = (nodes: BlockNode[]): BlockNode[] =>
    nodes.map((node) => {
      if (node.type === "metrics" && isLegacyStrip(node.attrs.items)) {
        changed = true;
        return { type: "metrics", attrs: { items: standingPromptItems() } };
      }
      if ((node.type === "blockquote" || node.type === "callout") && node.content) {
        const content = walk(node.content);
        return content === node.content ? node : { ...node, content };
      }
      return node;
    });
  const content = walk(doc.content);
  return changed ? { ...doc, content } : doc;
}

/**
 * The headline a card shows. Revenue YTD with chart data always shows the chart's total, so
 * the number above the chart and its last point cannot disagree.
 */
export function metricDisplayValue(item: MetricItem): string {
  return hasChartData(item.chart) ? formatShortUsd(chartTotal(item.chart)) : item.value;
}

/**
 * Revenue YTD cards whose value was filled without the monthly figures behind the chart.
 * Investor sends wait for those figures, so the email never shows a total with no chart.
 */
export function revenueChartGaps(doc: DocNode): number {
  let gaps = 0;
  const walk = (nodes: BlockNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "metrics") {
        for (const it of node.attrs.items) {
          if (it.label === REVENUE_YTD_LABEL && !hasChartData(it.chart) && !countPromptMarkers(it.value)) gaps++;
        }
      }
      if (node.type === "blockquote" || node.type === "callout") walk(node.content);
    }
  };
  walk(doc.content);
  return gaps;
}

export function starterDocument(): DocNode {
  return {
    type: "doc",
    content: [
      {
        type: "pullQuote",
        content: [prompt("a one-line quote that sets the theme of the quarter, then - Name. Don't reuse a source from a past update.")],
      },
      p(t("What do we do?", ["bold"]), t(WHAT_WE_DO)),
      p(
        t("TL;DR", ["bold"]),
        t(" "),
        prompt("two or three sentences carrying the quarter's three biggest facts, each with a number. Include the biggest setback if it changes the picture."),
      ),
      {
        type: "metrics",
        attrs: {
          items: standingPromptItems(),
        },
      },

      h("Commercial"),
      p(t("Research collaborations", ["bold"])),
      bullets(
        [prompt("one full-sentence claim, such as a contract signed, renewed or expanded. Then one or two sentences on why it matters. Describe partners by type and size, never by name.")],
        [prompt("next development with a partner, with value or timing where you can share it.")],
      ),
      p(t("Products", ["bold"])),
      bullets(
        [prompt("product progress: trials, first sales, channel partners by geography. Say whether results are lab or field.")],
      ),
      p(
        prompt("optional one-line summing up, for example how many paying partners you have and whether they're expanding."),
      ),

      h("R&D & Technology"),
      p(prompt("program or platform name, such as a product, Formulation or CinThesis")),
      p(
        prompt("what you found or built. Define any technical term at first use in a parenthesis, give the number, then the commercial \"so what\". Hedge preliminary data plainly: \"the data is not conclusive, but it supports...\""),
      ),
      bullets(
        [prompt("result with a number, for example a cost, speed or potency change against a stated baseline.")],
        [prompt("result with a number.")],
      ),

      h("Lowlights"),
      bullets(
        [prompt("what slipped, in one plain sentence. Then why, and what changes as a result.")],
        [prompt("a risk investors should know about, such as concentration, timing or supply, and the response.")],
      ),
    ],
  };
}

/** Optional sections in the same voice, for updates that need them. */
export const OPTIONAL_SECTIONS: { id: string; label: string; blocks: BlockNode[] }[] = [
  {
    id: "asks",
    label: "Asks",
    blocks: [
      h("Asks"),
      bullets([prompt("specific help you want from investors, such as an introduction to a role at a type of company, or expertise in a named area.")]),
    ],
  },
  {
    id: "fundraising",
    label: "Fundraising",
    blocks: [
      p(t("Fundraising", ["bold"])),
      p(prompt("the round size and type, the three uses of funds, and one clear next step with a link to the deck or a booking page.")),
    ],
  },
  {
    id: "founder-note",
    label: "Founder note",
    blocks: [p(prompt("a short first-person note, for example a change in cadence or a personal thank-you. Keep it to three sentences."))],
  },
  {
    id: "platform-metrics",
    label: "Platform metrics",
    blocks: [
      p(t("CinThesis", ["bold"])),
      bullets(
        [t("Cost per candidate: "), prompt("change vs. last quarter")],
        [t("Time to candidate: "), prompt("change vs. last quarter")],
        [t("Genomes run to date: "), prompt("count")],
      ),
    ],
  },
  {
    id: "thanks",
    label: "Thanks",
    blocks: [
      h("Thanks"),
      p(prompt("name each person, with their permission, and the specific help they gave.")),
    ],
  },
];

/** Count unfilled `[Write: …]` prompts in a string (overlapping markers are not double-counted). */
export function countPromptMarkers(text: string): number {
  let count = 0;
  for (let i = text.indexOf(PROMPT_OPEN); i !== -1; i = text.indexOf(PROMPT_OPEN, i + PROMPT_OPEN.length)) count++;
  return count;
}

/** Number of unfilled template prompts anywhere in a document, including metric values. */
export function templatePromptCount(doc: unknown): number {
  let count = 0;
  const walk = (nodes: unknown[] | undefined) => {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== "object") continue;
      const node = n as {
        type?: string;
        text?: string;
        attrs?: { items?: { value?: string }[] };
        content?: unknown[];
      };
      if (node.type === "text" && typeof node.text === "string") count += countPromptMarkers(node.text);
      if (node.type === "metrics" && Array.isArray(node.attrs?.items)) {
        for (const item of node.attrs.items) {
          if (typeof item?.value === "string") count += countPromptMarkers(item.value);
        }
      }
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  if (doc && typeof doc === "object" && (doc as { type?: string }).type === "doc") {
    walk((doc as DocNode).content);
  } else {
    // Fallback for malformed input (e.g. in tests with partial docs).
    count = countPromptMarkers(JSON.stringify(doc ?? null));
  }
  return count;
}
