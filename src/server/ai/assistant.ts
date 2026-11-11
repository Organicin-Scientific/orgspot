import "server-only";
import { SchemaType, VertexAI, type Content, type GenerationConfig, type Part } from "@google-cloud/vertexai";
import { z } from "zod";
import {
  clampLabel,
  describeHit,
  promptBlockIndex,
  ResponseScanner,
  thoughtHeadlines,
} from "@/lib/content/assistant-progress";
import {
  applyAssistantChanges,
  applyRevenueMonths,
  ASSISTANT_BLOCK_TYPES,
  ASSISTANT_EDIT_OPS,
  docOutline,
  type AssistantEdit,
} from "@/lib/content/assistant-edits";
import { applyPromptFills, listTemplatePrompts, promptKeysIn, stripPromptMarkers, type ListedPrompt } from "@/lib/content/prompt-fills";
import { MONTH_NAMES, REVENUE_YTD_LABEL } from "@/lib/content/revenue-chart";
import { parseDoc, type DocNode } from "@/lib/content/schema";
import type { AssistantMessage } from "@/lib/types";
import { env } from "../env";
import { badRequest, serviceUnavailable } from "../http/errors";
import { log } from "../logger";
import { aiDraftConfigured, DEFAULT_GEMINI_MODEL, vertexApiEndpoint, vertexLocation, vertexServiceAccount } from "./config";
import type { SourceAttachment } from "./source-text";
import { FACT_RULES, VOICE_RULES } from "./voice";

const SYSTEM_PROMPT = `You are the drafting assistant inside Organicin Scientific's investor update editor. You and the author work on one quarterly investor update together. The author talks to you, pastes notes, or attaches a document (PDF, Word, Markdown or text). Markdown arrives as raw text; read headings, lists and tables by their markup. Your job is to put their material into the update inside the existing template, and to answer questions about the draft.

Each author message comes with the update as it stands: a numbered outline of its top-level blocks, and the list of unfilled "[Write: …]" template prompts with their ids.

How you change the update:
- Use "fills" to answer template prompts by id. Follow each prompt's instruction.
- Use "removals" for the ids of prompts the material doesn't support. That includes optional prompts, spare bullets and metric cards with no matching figure. A removed prompt takes its empty bullet or label with it. Leave a prompt in place only when the author has to supply something you can't, and name it in the reply.
- Use "edits" for anything else. "replace" rewrites the block at an outline index. "insert_after" adds a new block after an index (-1 puts it at the top). "delete" removes a block. Indices always refer to the outline in the latest message, so several edits in one reply never shift each other.
- Never invent a "[Write: …]" placeholder. Write finished text, or leave the thing out.
- The author's material can hold its own "[Write: …]" placeholders: facts only the author can supply, such as a date or a count. Copy each one exactly, brackets included, into the sentence where that fact belongs. Never drop it, and never smooth the sentence around it so the gap disappears.
- Keep the template's sections and order. Don't delete headings, the opening quote, the "What do we do?" line or the metrics unless the author asks.
- The metrics strip holds the standing figures. Fill or remove its prompts, or replace its values, but never rename a card or add one.
- The Revenue YTD card is a chart built from cash received in each month. Never type its value; give "revenue_months" instead. Each entry is one month (1 = January) and the customer cash received in that month, in whole dollars. When the material gives running totals, give each month's difference from the month before. Include a month with no cash as 0. When the card already has months (shown in the outline), give only the months after its last one, normally the latest quarter, unless the material corrects an earlier month. Give months only through the last complete or as-of month the material covers. Leave "revenue_months" empty when the material has no monthly figures.
- For a replaced or inserted block give "type" plus "text" (paragraph, heading, pull_quote), "items" (bullet_list, numbered_list, metrics as "Label | value"), and "level" 2 or 3 for headings. Use **double asterisks** for bold. Keep bold labels the template uses, such as **TL;DR**.
- To revise text that is already written, replace its block with the full new version.
- Change the update only when the author asks for a change or gives material to draft from. For questions or conversation, answer in "reply" and return empty "fills", "removals" and "edits".

When the author gives you a document to draft from:
- Put every material fact from it into the update: wins, setbacks, figures, dates, corrections and financial notes. Keep the author's numbers exactly as written.
- When a section has more items than the template has prompts, replace that list with one that holds them all. When a fact fits no section, add it as a short paragraph where it reads best, such as a financial note after Lowlights.
- Add nothing the document doesn't say.
- List in "left_out" each fact from the document you didn't use, one short line each, with the reason. Return an empty list when everything went in.

"reply" is shown in the chat beside the document: one to four short plain-text sentences, no markdown, no lists. Say what you changed and what is still missing or uncertain. Don't repeat the drafted text.

${FACT_RULES}

${VOICE_RULES}`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    reply: { type: SchemaType.STRING },
    removals: { type: SchemaType.ARRAY, items: { type: SchemaType.INTEGER } },
    left_out: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    revenue_months: {
      type: SchemaType.OBJECT,
      properties: {
        year: { type: SchemaType.INTEGER },
        months: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: { month: { type: SchemaType.INTEGER }, cash: { type: SchemaType.NUMBER } },
            required: ["month", "cash"],
          },
        },
      },
    },
    fills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: { id: { type: SchemaType.INTEGER }, text: { type: SchemaType.STRING } },
        required: ["id", "text"],
      },
    },
    edits: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          op: { type: SchemaType.STRING, enum: [...ASSISTANT_EDIT_OPS] },
          index: { type: SchemaType.INTEGER },
          type: { type: SchemaType.STRING, enum: [...ASSISTANT_BLOCK_TYPES] },
          text: { type: SchemaType.STRING },
          level: { type: SchemaType.INTEGER },
          items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["op", "index"],
      },
    },
  },
  required: ["reply", "fills", "removals", "edits", "left_out"],
};

const responseShape = z.object({
  reply: z.string().max(4_000),
  removals: z.array(z.number().int().min(0).max(500)).max(200).default([]),
  left_out: z.array(z.string().max(500)).max(40).default([]),
  revenue_months: z
    .object({
      year: z.number().int(),
      months: z.array(z.object({ month: z.number().int(), cash: z.number() })).max(12),
    })
    .nullable()
    .optional()
    .catch(undefined),
  fills: z.array(z.object({ id: z.number().int().min(0).max(500), text: z.string().max(8_000) })).max(200),
  edits: z
    .array(
      z.object({
        op: z.enum(ASSISTANT_EDIT_OPS),
        index: z.number().int().min(-1).max(2_000),
        type: z.enum(ASSISTANT_BLOCK_TYPES).optional().catch(undefined),
        text: z.string().max(8_000).optional(),
        level: z.number().int().optional(),
        items: z.array(z.string().max(4_000)).max(40).optional(),
      }),
    )
    .max(100),
});

const HISTORY_MESSAGES = 20;
const HISTORY_CHARS_PER_MESSAGE = 6_000;
const HISTORY_CHARS_TOTAL = 60_000;

export interface AssistantTurnResult {
  reply: string;
  content: DocNode | null;
  filled: number;
  removed: number;
  edited: number;
  remainingPrompts: number;
}

/** Earlier turns as Gemini contents, newest last, trimmed to a fixed budget. */
function historyContents(history: AssistantMessage[]): Content[] {
  const recent = history.slice(-HISTORY_MESSAGES);
  let budget = HISTORY_CHARS_TOTAL;
  const out: Content[] = [];
  for (let i = recent.length - 1; i >= 0 && budget > 0; i--) {
    const m = recent[i]!;
    let text = m.text.slice(0, Math.min(HISTORY_CHARS_PER_MESSAGE, budget));
    if (m.role === "user" && m.fileName) text += `\n(Attached ${m.fileName}; its content was read in that turn.)`;
    if (m.role === "assistant" && m.changeSummary) text += `\n(${m.changeSummary}.)`;
    budget -= text.length;
    out.unshift({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  // Gemini expects the conversation to start with a user turn.
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

function summarize(filled: number, removed: number, edited: number): string | null {
  const parts: string[] = [];
  const add = (n: number, verb: string, noun: string) => {
    if (!n) return;
    const word = parts.length ? verb.toLowerCase() : verb;
    parts.push(`${word} ${n} ${noun}${n === 1 ? "" : "s"}`);
  };
  add(filled, "Filled", "prompt");
  add(removed, "Removed", "unused prompt");
  add(edited, "Edited", "block");
  return parts.length ? parts.join(", ") : null;
}

export function changeSummary(result: Pick<AssistantTurnResult, "filled" | "removed" | "edited">): string | null {
  return summarize(result.filled, result.removed, result.edited);
}

/** Shorten a prompt instruction to a readable name for the chat, e.g. "cash received YTD". */
function promptName(instruction: string): string {
  const first = instruction.split(/[.:]/)[0]!.trim();
  return first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first;
}

/**
 * The chat reply plus two lists the author shouldn't have to dig for: facts from the
 * attachment that didn't go in, and prompts still waiting for them.
 */
function composeReply(reply: string, leftOut: string[], remaining: ListedPrompt[]): string {
  const sections = [reply];
  if (leftOut.length) sections.push(["Not used from the attachment:", ...leftOut.map((l) => `- ${l}`)].join("\n"));
  if (remaining.length) sections.push(["Still to fill:", ...remaining.map((p) => `- ${promptName(p.instruction)}`)].join("\n"));
  return sections.join("\n\n");
}

export async function runAssistantTurn(opts: {
  doc: DocNode;
  history: AssistantMessage[];
  message: string;
  source: SourceAttachment | null;
  /** Called with a short label each time the turn moves on, for the chat's live ticker. */
  onStep?: (label: string) => void;
}): Promise<AssistantTurnResult> {
  const step = (label: string) => opts.onStep?.(clampLabel(label));
  if (!aiDraftConfigured()) {
    throw serviceUnavailable("The assistant is not configured. Enable Vertex AI and set AI_DRAFT_ENABLED=true.");
  }
  const credentials = vertexServiceAccount();
  if (!credentials) throw serviceUnavailable("Vertex credentials are not configured.");

  const e = env();
  const location = vertexLocation();
  const vertex = new VertexAI({
    project: e.FIREBASE_PROJECT_ID,
    location,
    apiEndpoint: vertexApiEndpoint(location),
    googleAuthOptions: { credentials },
  });
  const model = vertex.getGenerativeModel({
    model: e.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 16_384,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Thought summaries stream ahead of the answer and become the ticker's headlines.
      // The SDK's types predate this field; Vertex accepts it for thinking models.
      thinkingConfig: { includeThoughts: true },
    } as GenerationConfig,
  });

  const prompts = listTemplatePrompts(opts.doc);
  const promptList = prompts.length
    ? prompts.map((p) => `- id ${p.id} (${p.kind}): ${p.instruction}`).join("\n")
    : "(none left)";

  const turnText = [
    "The update as it stands:",
    docOutline(opts.doc),
    revenueChartLine(opts.doc),
    "",
    "Unfilled template prompts:",
    promptList,
    "",
    `Author: ${opts.message.trim() || "(no message; draft the update from the attached document)"}`,
    opts.source?.kind === "text" ? `\nAttached document (${opts.source.filename}):\n${opts.source.text}` : "",
    opts.source?.kind === "pdf" ? `\nAttached PDF: ${opts.source.filename}. Use it as the primary factual source.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts: Part[] = [{ text: turnText }];
  if (opts.source?.kind === "pdf") parts.push({ inlineData: { mimeType: opts.source.mimeType, data: opts.source.base64 } });

  const promptBlocks = promptBlockIndex(opts.doc);
  const scanner = new ScanTracker(opts.doc, promptBlocks, step);
  step(prompts.length ? `Sending the draft and ${prompts.length} open prompt${prompts.length === 1 ? "" : "s"} to Gemini` : "Sending the draft to Gemini");

  try {
    const result = await model.generateContentStream({ contents: [...historyContents(opts.history), { role: "user", parts }] });
    step("Gemini is reading");
    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        const text = "text" in part && typeof part.text === "string" ? part.text : "";
        if (!text) continue;
        if ((part as { thought?: boolean }).thought) scanner.thought(text);
        else scanner.answer(text);
      }
    }
  } catch (err) {
    log.error("assistant.gemini_failed", { error: err instanceof Error ? err.message : String(err) });
    throw serviceUnavailable("Gemini didn't respond. Try again in a moment.");
  }
  const raw = scanner.text;
  if (!raw.trim()) throw badRequest("Gemini returned an empty response. Try again or shorten the attachment.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest("Gemini returned an unreadable response. Try again.");
  }
  const parsed = responseShape.safeParse(json);
  if (!parsed.success) throw badRequest("Gemini returned an unexpected response. Try again.");

  // Placeholders the author wrote in their own material survive the model's output.
  const keep = promptKeysIn([opts.message, opts.source?.kind === "text" ? opts.source.text : ""].join("\n"));
  const knownIds = new Set(prompts.map((p) => p.id));
  const fills = new Map<number, string>();
  for (const f of parsed.data.fills) {
    const text = stripPromptMarkers(f.text, keep);
    if (knownIds.has(f.id) && text) fills.set(f.id, text);
  }
  const removals = new Set(parsed.data.removals.filter((id) => knownIds.has(id) && !fills.has(id)));
  // Drafting from a document finishes the template: an optional prompt the document didn't
  // fill has nothing to say, so it goes rather than sitting in the update as "[Write: …]".
  if (opts.source) {
    for (const p of prompts) if (p.optional && !fills.has(p.id)) removals.add(p.id);
  }
  const edits: AssistantEdit[] = parsed.data.edits;
  const leftOut = parsed.data.left_out.map((l) => l.trim()).filter(Boolean);
  const months = parsed.data.revenue_months?.months?.length ? parsed.data.revenue_months : null;

  const reply = parsed.data.reply.trim() || "Done.";
  const unchanged = (): AssistantTurnResult => ({
    // A question gets a plain answer; the to-do list is for turns that drafted.
    reply: composeReply(reply, leftOut, opts.source ? prompts : []),
    content: null,
    filled: 0,
    removed: 0,
    edited: 0,
    remainingPrompts: prompts.length,
  });
  if (fills.size === 0 && removals.size === 0 && edits.length === 0 && !months) return unchanged();

  step("Checking the changes fit the template");
  const applied = applyAssistantChanges(opts.doc, fills, edits, removals, keep);
  let doc = keepRevenueCard(opts.doc, applied.doc);
  let removed = applied.removed;
  let edited = applied.edited;
  let chartNote: string | null = null;
  if (months) {
    const charted = applyRevenueMonths(doc, months);
    if (charted.changed) {
      doc = charted.doc;
      edited += 1;
    } else chartNote = charted.problem;
  }
  // Edits can re-introduce an optional prompt only by keeping an old block; sweep once more.
  if (opts.source) {
    const stray = new Set(listTemplatePrompts(doc).filter((p) => p.optional).map((p) => p.id));
    if (stray.size) {
      const swept = applyPromptFills(doc, new Map(), stray);
      doc = swept.doc;
      removed += swept.removed;
    }
  }
  const validated = parseDoc(doc);
  if (!validated.ok) {
    log.warn("assistant.invalid_doc", { error: validated.error });
    throw badRequest("Gemini's edit didn't fit the update's format. Try rephrasing the request.");
  }
  if (applied.filled === 0 && removed === 0 && edited === 0) return chartNote ? { ...unchanged(), reply: `${unchanged().reply}\n\n${chartNote}` } : unchanged();
  const remaining = listTemplatePrompts(validated.doc);
  return {
    reply: composeReply(chartNote ? `${reply} ${chartNote}` : reply, leftOut, remaining),
    content: validated.doc,
    filled: applied.filled,
    removed,
    edited,
    remainingPrompts: remaining.length,
  };
}

/** The Revenue YTD card's monthly figures, so the model knows which months are already in. */
function revenueChartLine(doc: DocNode): string {
  for (const block of doc.content) {
    if (block.type !== "metrics") continue;
    const card = block.attrs.items.find((m) => m.label === REVENUE_YTD_LABEL);
    if (!card) continue;
    if (!card.chart?.months.length) return "Revenue YTD card monthly figures: none entered yet.";
    const list = card.chart.months.map((v, i) => `${MONTH_NAMES[i]} $${Math.round(v)}`).join(", ");
    return `Revenue YTD card monthly figures (${card.chart.year}): ${list}.`;
  }
  return "";
}

/**
 * A metric fill can't put a typed value on the Revenue YTD card: its headline must come
 * from monthly figures, or the card shows a number with no chart. Put the card back as it
 * was; `revenue_months` is the only way the assistant changes it.
 */
function keepRevenueCard(before: DocNode, after: DocNode): DocNode {
  const card = (d: DocNode) => {
    for (const b of d.content) if (b.type === "metrics") {
      const c = b.attrs.items.find((m) => m.label === REVENUE_YTD_LABEL);
      if (c) return c;
    }
    return null;
  };
  const old = card(before);
  const now = card(after);
  if (!old || !now || now.chart || now.value === old.value) return after;
  return {
    ...after,
    content: after.content.map((b) =>
      b.type === "metrics" ? { ...b, attrs: { ...b.attrs, items: b.attrs.items.map((m) => (m === now ? { ...m, value: old.value } : m)) } } : b,
    ),
  };
}

/** Turns streamed thought and answer text into ticker steps, and keeps the answer for parsing. */
class ScanTracker {
  private readonly answerScan = new ResponseScanner();
  private thoughts = "";
  private headlinesSent = 0;

  constructor(
    private readonly doc: DocNode,
    private readonly promptBlocks: Map<number, number>,
    private readonly step: (label: string) => void,
  ) {}

  get text(): string {
    return this.answerScan.text;
  }

  thought(text: string) {
    this.thoughts += text;
    const heads = thoughtHeadlines(this.thoughts);
    for (; this.headlinesSent < heads.length; this.headlinesSent++) this.step(heads[this.headlinesSent]!);
  }

  answer(text: string) {
    for (const hit of this.answerScan.push(text)) {
      const label = describeHit(hit, this.doc, this.promptBlocks);
      if (label) this.step(label);
    }
  }
}
