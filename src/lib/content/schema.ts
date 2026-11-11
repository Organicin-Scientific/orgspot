import { z } from "zod";

/**
 * Allowlisted document model shared by the editor, email renderer and PDF renderer.
 * Anything not described here is rejected by the server, so stored content can never
 * carry raw HTML, scripts, event handlers or unexpected URL schemes.
 */

export const BRAND_TEXT_COLORS = [
  "#111827",
  "#4b5563",
  "#157a6e",
  "#174f73",
  "#9a3412",
  "#b91c1c",
] as const;

export const CALLOUT_TONES = ["note", "info", "success", "warning"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

const MAX_TEXT = 20_000;
const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isSafeHref(href: string): boolean {
  const v = href.trim();
  if (v.length === 0 || v.length > 2048) return false;
  try {
    const u = new URL(v);
    if (u.protocol === "mailto:") return true;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return false;
  } catch {
    return false;
  }
}

const alignAttr = z.enum(TEXT_ALIGNS).nullable().optional().catch(null);

const linkMark = z.object({
  type: z.literal("link"),
  attrs: z.object({ href: z.string().refine(isSafeHref, "Unsupported link") }),
});
const textStyleMark = z.object({
  type: z.literal("textStyle"),
  attrs: z
    .object({ color: z.string().regex(HEX_COLOR).nullable().optional().catch(null) })
    .optional(),
});
const simpleMark = z.object({ type: z.enum(["bold", "italic", "underline", "strike"]) });
const markSchema = z.discriminatedUnion("type", [linkMark, textStyleMark, simpleMark]);
export type Mark = z.infer<typeof markSchema>;

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT),
  marks: z.array(markSchema).max(8).optional(),
});
const hardBreak = z.object({ type: z.literal("hardBreak") });
const inlineNode = z.discriminatedUnion("type", [textNode, hardBreak]);
export type InlineNode = z.infer<typeof inlineNode>;

const inlineContent = z.array(inlineNode).max(2000).optional();

const paragraph = z.object({
  type: z.literal("paragraph"),
  attrs: z.object({ textAlign: alignAttr }).optional(),
  content: inlineContent,
});
const heading = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), textAlign: alignAttr }),
  content: inlineContent,
});

/** Monthly customer cash behind the Revenue YTD chart (see lib/content/revenue-chart.ts). */
const revenueChart = z.object({
  year: z.number().int().min(2000).max(2100),
  months: z.array(z.number().finite().min(0).max(1e11)).min(1).max(12),
});

export const metricItem = z.object({
  label: z.string().max(80),
  sublabel: z.string().max(120).default(""),
  value: z.string().max(40),
  chart: revenueChart.optional(),
});
export type MetricItem = z.infer<typeof metricItem>;

const metrics = z.object({
  type: z.literal("metrics"),
  attrs: z.object({ items: z.array(metricItem).min(1).max(4) }),
});

const image = z.object({
  type: z.literal("image"),
  attrs: z.object({
    assetId: z.string().regex(SAFE_ID),
    alt: z.string().max(300).default(""),
    width: z.number().int().min(40).max(600).nullable().optional().catch(null),
    align: z.enum(["left", "center", "right"]).default("center").catch("center"),
    // `src` is display-only inside the editor; renderers always rebuild it from assetId.
    src: z.string().max(2048).optional(),
  }),
});

const horizontalRule = z.object({
  type: z.literal("horizontalRule"),
  attrs: z.object({ variant: z.enum(["full", "short"]).default("full").catch("full") }).optional(),
});

export interface ParagraphNode {
  type: "paragraph";
  attrs?: { textAlign?: TextAlign | null };
  content?: InlineNode[];
}
export interface HeadingNode {
  type: "heading";
  attrs: { level: 1 | 2 | 3; textAlign?: TextAlign | null };
  content?: InlineNode[];
}
export interface ListItemNode {
  type: "listItem";
  content: BlockNode[];
}
export interface BulletListNode {
  type: "bulletList";
  content: ListItemNode[];
}
export interface OrderedListNode {
  type: "orderedList";
  attrs?: { start?: number };
  content: ListItemNode[];
}
export interface BlockquoteNode {
  type: "blockquote";
  content: BlockNode[];
}
export interface PullQuoteNode {
  type: "pullQuote";
  content?: InlineNode[];
}
export interface CalloutNode {
  type: "callout";
  attrs: { tone: CalloutTone };
  content: BlockNode[];
}
export interface TableCellNode {
  type: "tableCell" | "tableHeader";
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] | null };
  content: BlockNode[];
}
export interface TableRowNode {
  type: "tableRow";
  content: TableCellNode[];
}
export interface TableNode {
  type: "table";
  content: TableRowNode[];
}
export type MetricsNode = z.infer<typeof metrics>;
export type ImageNode = z.infer<typeof image>;
export type HorizontalRuleNode = z.infer<typeof horizontalRule>;

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | PullQuoteNode
  | CalloutNode
  | TableNode
  | MetricsNode
  | ImageNode
  | HorizontalRuleNode;

export interface DocNode {
  type: "doc";
  content: BlockNode[];
}

const blockNode: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    paragraph,
    heading,
    bulletList,
    orderedList,
    blockquote,
    pullQuote,
    callout,
    table,
    metrics,
    image,
    horizontalRule,
  ]),
) as z.ZodType<BlockNode>;

const listItem = z.object({ type: z.literal("listItem"), content: z.array(blockNode).min(1).max(50) });
const bulletList = z.object({ type: z.literal("bulletList"), content: z.array(listItem).min(1).max(200) });
const orderedList = z.object({
  type: z.literal("orderedList"),
  attrs: z.object({ start: z.number().int().min(0).max(10_000).default(1).catch(1) }).optional(),
  content: z.array(listItem).min(1).max(200),
});
const blockquote = z.object({ type: z.literal("blockquote"), content: z.array(blockNode).min(1).max(50) });
const pullQuote = z.object({ type: z.literal("pullQuote"), content: inlineContent });
const callout = z.object({
  type: z.literal("callout"),
  attrs: z.object({ tone: z.enum(CALLOUT_TONES).default("note").catch("note") }),
  content: z.array(blockNode).min(1).max(50),
});
const tableCell = z.object({
  type: z.enum(["tableCell", "tableHeader"]),
  attrs: z
    .object({
      colspan: z.number().int().min(1).max(10).default(1).catch(1),
      rowspan: z.number().int().min(1).max(50).default(1).catch(1),
      colwidth: z.array(z.number().int().min(10).max(600)).nullable().optional().catch(null),
    })
    .optional(),
  content: z.array(blockNode).min(1).max(20),
});
const tableRow = z.object({ type: z.literal("tableRow"), content: z.array(tableCell).min(1).max(10) });
const table = z.object({ type: z.literal("table"), content: z.array(tableRow).min(1).max(100) });

export const docSchema: z.ZodType<DocNode> = z.object({
  type: z.literal("doc"),
  content: z.array(blockNode).max(2000),
}) as z.ZodType<DocNode>;

export const MAX_DOC_BYTES = 600_000;

export type ParseDocResult = { ok: true; doc: DocNode } | { ok: false; error: string };

/** Validate untrusted editor JSON. Unknown attributes are stripped, unknown nodes rejected. */
export function parseDoc(input: unknown): ParseDocResult {
  let size = 0;
  try {
    size = JSON.stringify(input ?? null).length;
  } catch {
    return { ok: false, error: "Content is not serialisable" };
  }
  if (size > MAX_DOC_BYTES) return { ok: false, error: "Content is too large" };
  if (depth(input) > 12) return { ok: false, error: "Content is nested too deeply" };
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `Unsupported content at ${first.path.join(".")}: ${first.message}` };
  }
  return { ok: true, doc: normalizeDoc(parsed.data) };
}

function depth(node: unknown, d = 0): number {
  if (!node || typeof node !== "object" || d > 20) return d;
  const content = (node as { content?: unknown }).content;
  if (!Array.isArray(content)) return d;
  let max = d;
  for (const child of content) max = Math.max(max, depth(child, d + 1));
  return max;
}

function normalizeDoc(doc: DocNode): DocNode {
  return { type: "doc", content: doc.content.length ? doc.content : [{ type: "paragraph" }] };
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/** Collect every asset id referenced by images in a document. */
export function collectAssetIds(doc: DocNode): string[] {
  const ids = new Set<string>();
  const walk = (nodes: unknown[] | undefined) => {
    for (const n of nodes ?? []) {
      const node = n as { type: string; attrs?: { assetId?: string }; content?: unknown[] };
      if (node.type === "image" && node.attrs?.assetId) ids.add(node.attrs.assetId);
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  walk(doc.content);
  return [...ids];
}
