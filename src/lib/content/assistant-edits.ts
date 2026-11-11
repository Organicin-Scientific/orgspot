import { applyPromptFills, stripPromptMarkers } from "./prompt-fills";
import { chartTotal, formatShortUsd, REVENUE_YTD_LABEL } from "./revenue-chart";
import type { BlockNode, DocNode, InlineNode, ListItemNode } from "./schema";

/**
 * Structured edits the drafting assistant can make to an update.
 *
 * The model sees a numbered outline of the document's top-level blocks (`docOutline`) and
 * answers with two lists: `fills` for `[Write: …]` template prompts, and `edits` that
 * replace, insert or delete whole top-level blocks by their outline index. Indices always
 * refer to the outline the model was shown, so several edits in one reply never shift each
 * other. Anything malformed is skipped rather than guessed at; the server validates the
 * result with `parseDoc` before it reaches the editor.
 */

export const ASSISTANT_BLOCK_TYPES = ["paragraph", "heading", "bullet_list", "numbered_list", "pull_quote", "metrics"] as const;
export type AssistantBlockType = (typeof ASSISTANT_BLOCK_TYPES)[number];

export const ASSISTANT_EDIT_OPS = ["replace", "insert_after", "delete"] as const;
export type AssistantEditOp = (typeof ASSISTANT_EDIT_OPS)[number];

export interface AssistantEdit {
  op: AssistantEditOp;
  /** Outline index of the block. For insert_after, -1 inserts at the very top. */
  index: number;
  type?: AssistantBlockType;
  /** Text for paragraph, heading and pull quote. `**bold**` is honoured. */
  text?: string;
  /** Heading level, 2 or 3. */
  level?: number;
  /** List items, or metric items written as "Label | value" or "Label | sublabel | value". */
  items?: string[];
}

export interface AssistantChangeResult {
  doc: DocNode;
  filled: number;
  removed: number;
  edited: number;
  skipped: number;
}

const MAX_TEXT = 5_000;
const MAX_ITEMS = 30;

// ---------------------------------------------------------------------------
// Outline shown to the model

function inlineMarkup(nodes: InlineNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      return n.marks?.some((m) => m.type === "bold") ? `**${n.text}**` : n.text;
    })
    .join("");
}

function itemText(item: ListItemNode): string {
  return item.content
    .map((b) => (b.type === "paragraph" || b.type === "heading" ? inlineMarkup(b.content) : outlineBody(b)))
    .join(" ")
    .trim();
}

function outlineBody(block: BlockNode): string {
  switch (block.type) {
    case "paragraph":
    case "pullQuote":
      return inlineMarkup(block.content);
    case "heading":
      return inlineMarkup(block.content);
    case "bulletList":
    case "orderedList":
      return block.content.map((li) => `- ${itemText(li)}`).join("\n");
    case "metrics":
      return block.attrs.items.map((m) => [m.label, m.sublabel, m.value].filter(Boolean).join(" | ")).join("\n");
    case "blockquote":
    case "callout":
      return block.content.map(outlineBody).join("\n");
    case "table":
      return block.content.map((row) => row.content.map((c) => c.content.map(outlineBody).join(" ")).join(" | ")).join("\n");
    case "image":
      return block.attrs.alt ? `image: ${block.attrs.alt}` : "image";
    case "horizontalRule":
      return "divider";
  }
}

function outlineLabel(block: BlockNode): string {
  switch (block.type) {
    case "paragraph":
      return "paragraph";
    case "heading":
      return `heading (level ${block.attrs.level})`;
    case "bulletList":
      return "bullet_list";
    case "orderedList":
      return "numbered_list";
    case "pullQuote":
      return "pull_quote";
    case "metrics":
      return "metrics (items as Label | sublabel | value)";
    default:
      return `${block.type} (read-only: keep or delete, do not replace)`;
  }
}

/** Numbered outline of top-level blocks, as the model sees the update. */
export function docOutline(doc: DocNode): string {
  return doc.content
    .map((block, i) => {
      const body = outlineBody(block)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      return `[${i}] ${outlineLabel(block)}\n${body}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Building blocks from model output

/** Parse `**bold**` runs into text nodes; everything else is plain text. */
export function parseInline(raw: string): InlineNode[] {
  const text = raw.replace(/\r\n?/g, "\n").slice(0, MAX_TEXT);
  const out: InlineNode[] = [];
  const pushText = (value: string, bold: boolean) => {
    const lines = value.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (line) out.push(bold ? { type: "text", text: line, marks: [{ type: "bold" }] } : { type: "text", text: line });
    });
  };
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index), false);
    pushText(m[1]!, true);
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(text.slice(last), false);
  return out;
}

function paragraphOf(text: string): BlockNode {
  const content = parseInline(text.trim());
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function cleanItems(items: string[] | undefined, keep: ReadonlySet<string>): string[] {
  return (items ?? [])
    .map((s) => (typeof s === "string" ? stripPromptMarkers(s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), keep) : ""))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

/** Build a schema-valid block from one edit, or null when the edit is unusable. */
export function blockFromEdit(edit: AssistantEdit, keep: ReadonlySet<string> = new Set()): BlockNode | null {
  // The model writes finished text. A "[Write: …]" it types itself is a placeholder nobody
  // asked for, so it is dropped here rather than shown to investors. One copied from the
  // author's own material (`keep`) marks a fact only they can supply, so it stays.
  const text = typeof edit.text === "string" ? stripPromptMarkers(edit.text, keep) : "";
  switch (edit.type) {
    case "paragraph":
      return text ? paragraphOf(text) : null;
    case "heading": {
      const content = parseInline(text.replace(/\*\*/g, ""));
      if (!content.length) return null;
      return { type: "heading", attrs: { level: edit.level === 3 ? 3 : 2 }, content };
    }
    case "pull_quote": {
      const content = parseInline(text);
      return content.length ? { type: "pullQuote", content } : null;
    }
    case "bullet_list":
    case "numbered_list": {
      const items = cleanItems(edit.items, keep);
      if (!items.length) return null;
      const content: ListItemNode[] = items.map((item) => ({ type: "listItem", content: [paragraphOf(item)] }));
      return edit.type === "bullet_list" ? { type: "bulletList", content } : { type: "orderedList", attrs: { start: 1 }, content };
    }
    case "metrics": {
      const items = cleanItems(edit.items, new Set())
        .slice(0, 4)
        .map((line) => {
          const parts = line.split("|").map((p) => p.trim());
          if (parts.length < 2) return null;
          const [label, sublabel, value] = parts.length >= 3 ? [parts[0]!, parts[1]!, parts.slice(2).join(" ")] : [parts[0]!, "", parts[1]!];
          if (!label || !value) return null;
          return { label: label.slice(0, 80), sublabel: sublabel.slice(0, 120), value: value.slice(0, 40) };
        })
        .filter((m): m is { label: string; sublabel: string; value: string } => m !== null);
      return items.length ? { type: "metrics", attrs: { items } } : null;
    }
    default:
      return null;
  }
}

const EDITABLE_TYPES = new Set<BlockNode["type"]>(["paragraph", "heading", "bulletList", "orderedList", "pullQuote", "metrics"]);

type MetricItem = { label: string; sublabel: string; value: string; chart?: { year: number; months: number[] } };

/**
 * The metrics strip holds the standing figures investors compare quarter to quarter, so the
 * assistant can change values but never the cards' labels or count. A replacement is matched
 * to the existing cards by position; a value it leaves blank keeps what was there.
 */
function lockedMetrics(existing: MetricItem[], proposed: MetricItem[]): BlockNode | null {
  let changed = false;
  const items = existing.map((card, i) => {
    // Revenue YTD's headline is derived from its monthly figures (see applyRevenueMonths),
    // so a typed value would show a number with no chart behind it.
    if (card.label === REVENUE_YTD_LABEL || card.chart?.months?.length) return card;
    const value = proposed[i]?.value?.trim();
    if (!value || value === card.value) return card;
    changed = true;
    return { ...card, value: value.slice(0, 40) };
  });
  return changed ? { type: "metrics", attrs: { items } } : null;
}

// ---------------------------------------------------------------------------
// Applying a reply

/**
 * Apply template fills, then block edits addressed by original outline index.
 * Read-only blocks (images, tables, callouts) can be deleted or have blocks inserted
 * after them, but never replaced, so the assistant cannot drop an image by rewriting it.
 */
export function applyAssistantChanges(
  doc: DocNode,
  fills: ReadonlyMap<number, string>,
  edits: readonly AssistantEdit[],
  removals: ReadonlySet<number> = new Set(),
  keep: ReadonlySet<string> = new Set(),
): AssistantChangeResult {
  const filledResult = applyPromptFills(doc, fills, removals);
  const blocks = filledResult.doc.content;
  const n = blocks.length;

  const replaced = new Map<number, BlockNode>();
  const deleted = new Set<number>();
  const inserts = new Map<number, BlockNode[]>();
  let edited = 0;
  let skipped = 0;

  for (const edit of edits) {
    const index = Number.isInteger(edit.index) ? edit.index : NaN;
    if (edit.op === "insert_after") {
      if (!(index >= -1 && index < n)) { skipped++; continue; }
      // New metric strips are the author's call; the assistant only fills the existing one.
      if (edit.type === "metrics") { skipped++; continue; }
      const block = blockFromEdit(edit, keep);
      if (!block) { skipped++; continue; }
      inserts.set(index, [...(inserts.get(index) ?? []), block]);
      edited++;
      continue;
    }
    if (!(index >= 0 && index < n)) { skipped++; continue; }
    if (edit.op === "delete") {
      deleted.add(index);
      replaced.delete(index);
      edited++;
      continue;
    }
    if (edit.op === "replace") {
      const target = blocks[index]!;
      if (!EDITABLE_TYPES.has(target.type)) { skipped++; continue; }
      let block = target.type === "metrics" ? null : blockFromEdit(edit, keep);
      if (target.type === "metrics") {
        // Only a metrics edit can touch the strip, and only its values. The value is the last
        // "|" part of each line, so "Pipeline | $234K" and a bare "$234K" both work.
        const values = edit.type === "metrics" ? (edit.items ?? []).map((line) => stripPromptMarkers(String(line).split("|").pop() ?? "")) : [];
        block = lockedMetrics(target.attrs.items, values.map((value) => ({ label: "", sublabel: "", value })));
      } else if (block?.type === "metrics") {
        block = null;
      }
      if (!block) { skipped++; continue; }
      replaced.set(index, block);
      deleted.delete(index);
      edited++;
      continue;
    }
    skipped++;
  }

  const content: BlockNode[] = [...(inserts.get(-1) ?? [])];
  blocks.forEach((block, i) => {
    if (!deleted.has(i)) content.push(replaced.get(i) ?? block);
    content.push(...(inserts.get(i) ?? []));
  });

  return {
    doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
    filled: filledResult.filled,
    removed: filledResult.removed,
    edited,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Revenue YTD monthly figures

export interface RevenueMonthsInput {
  year: number;
  /** Customer cash received in each listed month; month 1 is January. */
  months: { month: number; cash: number }[];
}

export interface RevenueMonthsResult {
  doc: DocNode;
  changed: boolean;
  /** Why nothing changed, for the chat; null when the chart was updated. */
  problem: string | null;
}

/**
 * Put monthly cash figures from the assistant onto the Revenue YTD card. Months already on
 * the card keep their values unless the author's material restates them, so a new quarter
 * can be added on its own. The months must run from January with no gap; anything else is
 * refused rather than guessed at, and the card's headline is rederived from the months.
 */
export function applyRevenueMonths(doc: DocNode, input: RevenueMonthsInput): RevenueMonthsResult {
  const unchanged = (problem: string): RevenueMonthsResult => ({ doc, changed: false, problem });
  const index = doc.content.findIndex((b) => b.type === "metrics" && b.attrs.items.some((m) => m.label === REVENUE_YTD_LABEL));
  if (index < 0) return unchanged("The update has no Revenue YTD card.");
  const block = doc.content[index]!;
  if (block.type !== "metrics") return unchanged("The update has no Revenue YTD card.");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) return unchanged("The monthly figures had no valid year.");

  const given = new Map<number, number>();
  for (const { month, cash } of input.months) {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(cash) || cash < 0 || cash > 1e11) {
      return unchanged("The monthly figures included a month or amount that isn't valid.");
    }
    given.set(month, Math.round(cash));
  }
  if (!given.size) return unchanged("No monthly figures were given.");

  const card = block.attrs.items.find((m) => m.label === REVENUE_YTD_LABEL)!;
  const existing = card.chart && card.chart.year === input.year ? card.chart.months : [];
  const through = Math.max(existing.length, ...given.keys());
  const months: number[] = [];
  for (let m = 1; m <= through; m++) {
    const value = given.has(m) ? given.get(m)! : existing[m - 1];
    if (value === undefined) {
      return unchanged(`The Revenue YTD card needs ${MONTHS[m - 1]} ${input.year} before later months can be added.`);
    }
    months.push(value);
  }

  const chart = { year: input.year, months };
  const same = card.chart?.year === chart.year && card.chart.months.length === months.length && card.chart.months.every((v, i) => v === months[i]);
  if (same) return unchanged("The Revenue YTD card already has these figures.");
  const items = block.attrs.items.map((m) => (m === card ? { ...m, chart, value: formatShortUsd(chartTotal(chart)) } : m));
  const content = doc.content.map((b, i) => (i === index ? { type: "metrics" as const, attrs: { ...block.attrs, items } } : b));
  return { doc: { ...doc, content }, changed: true, problem: null };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
