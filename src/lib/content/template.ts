import type { BlockNode, DocNode } from "./schema";

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
          items: [
            { label: "Revenue this quarter", sublabel: "", value: `${PROMPT_OPEN}$]` },
            { label: "Contracts signed", sublabel: "", value: `${PROMPT_OPEN}$]` },
            { label: "Pipeline", sublabel: "next two quarters", value: `${PROMPT_OPEN}$]` },
          ],
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

/** Number of unfilled template prompts anywhere in a document, including metric values. */
export function templatePromptCount(doc: unknown): number {
  const json = JSON.stringify(doc ?? null);
  let count = 0;
  for (let i = json.indexOf(PROMPT_OPEN); i !== -1; i = json.indexOf(PROMPT_OPEN, i + PROMPT_OPEN.length)) count++;
  return count;
}
