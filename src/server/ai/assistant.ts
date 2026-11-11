import "server-only";
import { SchemaType, VertexAI, type Content, type Part } from "@google-cloud/vertexai";
import { z } from "zod";
import {
  applyAssistantChanges,
  ASSISTANT_BLOCK_TYPES,
  ASSISTANT_EDIT_OPS,
  docOutline,
  type AssistantEdit,
} from "@/lib/content/assistant-edits";
import { listTemplatePrompts } from "@/lib/content/prompt-fills";
import { parseDoc, type DocNode } from "@/lib/content/schema";
import type { AssistantMessage } from "@/lib/types";
import { env } from "../env";
import { badRequest, serviceUnavailable } from "../http/errors";
import { log } from "../logger";
import { aiDraftConfigured, DEFAULT_GEMINI_MODEL, vertexApiEndpoint, vertexLocation, vertexServiceAccount } from "./config";
import type { SourceAttachment } from "./source-text";
import { FACT_RULES, VOICE_RULES } from "./voice";

const SYSTEM_PROMPT = `You are the drafting assistant inside Organicin Scientific's investor update editor. You and the author work on one quarterly investor update together. The author talks to you, pastes notes, or attaches a document (PDF, Word or text). Your job is to put their material into the update inside the existing template, and to answer questions about the draft.

Each author message comes with the update as it stands: a numbered outline of its top-level blocks, and the list of unfilled "[Write: …]" template prompts with their ids.

How you change the update:
- Use "fills" to answer template prompts by id. Follow each prompt's instruction. When a prompt fits the material, fill it rather than adding new blocks.
- Use "edits" for anything else. "replace" rewrites the block at an outline index. "insert_after" adds a new block after an index (-1 puts it at the top). "delete" removes a block. Indices always refer to the outline in the latest message, so several edits in one reply never shift each other.
- Keep the template's sections and order. Don't delete headings, the opening quote, the "What do we do?" line or the metrics unless the author asks.
- For a replaced or inserted block give "type" plus "text" (paragraph, heading, pull_quote), "items" (bullet_list, numbered_list, metrics as "Label | value" or "Label | sublabel | value"), and "level" 2 or 3 for headings. Use **double asterisks** for bold. Keep bold labels the template uses, such as **TL;DR**.
- To revise text that is already written, replace its block with the full new version.
- Change the update only when the author asks for a change or gives material to draft from. For questions or conversation, answer in "reply" and return empty "fills" and "edits".
- If the material doesn't support a prompt, leave it unfilled and say what's missing.

"reply" is shown in the chat beside the document: one to four short plain-text sentences, no markdown, no lists. Say what you changed and what is still missing or uncertain. Don't repeat the drafted text.

${FACT_RULES}

${VOICE_RULES}`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    reply: { type: SchemaType.STRING },
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
  required: ["reply", "fills", "edits"],
};

const responseShape = z.object({
  reply: z.string().max(4_000),
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

function summarize(filled: number, edited: number): string | null {
  const parts: string[] = [];
  if (filled) parts.push(`Filled ${filled} prompt${filled === 1 ? "" : "s"}`);
  if (edited) parts.push(`${parts.length ? "edited" : "Edited"} ${edited} block${edited === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : null;
}

export function changeSummary(result: Pick<AssistantTurnResult, "filled" | "edited">): string | null {
  return summarize(result.filled, result.edited);
}

export async function runAssistantTurn(opts: {
  doc: DocNode;
  history: AssistantMessage[];
  message: string;
  source: SourceAttachment | null;
}): Promise<AssistantTurnResult> {
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
    },
  });

  const prompts = listTemplatePrompts(opts.doc);
  const promptList = prompts.length
    ? prompts.map((p) => `- id ${p.id} (${p.kind}): ${p.instruction}`).join("\n")
    : "(none left)";

  const turnText = [
    "The update as it stands:",
    docOutline(opts.doc),
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

  let raw = "";
  try {
    const result = await model.generateContent({ contents: [...historyContents(opts.history), { role: "user", parts }] });
    raw =
      result.response.candidates?.[0]?.content?.parts
        ?.map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
        .join("") ?? "";
  } catch (err) {
    log.error("assistant.gemini_failed", { error: err instanceof Error ? err.message : String(err) });
    throw serviceUnavailable("Gemini didn't respond. Try again in a moment.");
  }
  if (!raw.trim()) throw badRequest("Gemini returned an empty response. Try again or shorten the attachment.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest("Gemini returned an unreadable response. Try again.");
  }
  const parsed = responseShape.safeParse(json);
  if (!parsed.success) throw badRequest("Gemini returned an unexpected response. Try again.");

  const knownIds = new Set(prompts.map((p) => p.id));
  const fills = new Map<number, string>();
  for (const f of parsed.data.fills) {
    const text = f.text.trim();
    if (knownIds.has(f.id) && text) fills.set(f.id, text);
  }
  const edits: AssistantEdit[] = parsed.data.edits;

  const reply = parsed.data.reply.trim() || "Done.";
  if (fills.size === 0 && edits.length === 0) {
    return { reply, content: null, filled: 0, edited: 0, remainingPrompts: prompts.length };
  }

  const applied = applyAssistantChanges(opts.doc, fills, edits);
  const validated = parseDoc(applied.doc);
  if (!validated.ok) {
    log.warn("assistant.invalid_doc", { error: validated.error });
    throw badRequest("Gemini's edit didn't fit the update's format. Try rephrasing the request.");
  }
  if (applied.filled === 0 && applied.edited === 0) {
    return { reply, content: null, filled: 0, edited: 0, remainingPrompts: prompts.length };
  }
  return {
    reply,
    content: validated.doc,
    filled: applied.filled,
    edited: applied.edited,
    remainingPrompts: listTemplatePrompts(validated.doc).length,
  };
}
