import "server-only";
import { SchemaType, VertexAI, type Part } from "@google-cloud/vertexai";
import { z } from "zod";
import type { DocNode } from "@/lib/content/schema";
import { listTemplatePrompts } from "@/lib/content/prompt-fills";
import { badRequest } from "../http/errors";
import { env } from "../env";
import { aiDraftConfigured, DEFAULT_GEMINI_MODEL, DEFAULT_VERTEX_LOCATION, vertexServiceAccount } from "./config";
import type { SourceAttachment } from "./source-text";

const fillsResponseSchema = z.object({
  fills: z
    .array(
      z.object({
        id: z.number().int().min(0).max(500),
        text: z.string().max(8000),
      }),
    )
    .max(200),
});

const STYLE_RULES = `You draft investor-update prose for Organicin Scientific.

Rules:
- Follow each writing prompt's instruction exactly for that id.
- Numbers must come from the source material. Never invent financial figures, counts, or dates.
- Do not name customers or partners; describe them by type and size only (per the prompts).
- If the source lacks information for a prompt, omit that id from the fills array (do not guess).
- Metric values (kind "metric") must be very short (under 40 characters): figures like "$1.2M", "3", or "Q2 2026".
- Output must be JSON only, matching the schema.

Voice (the founders writing to investors who already backed the company):
- Candid and specific. Every claim carries a number, a place, or a date. No adjectives standing in for evidence ("significant progress", "exciting momentum", "strong interest").
- Open each bullet with a full-sentence claim, then one or two sentences of support and why it matters commercially. No title-case labels followed by a colon.
- Strategic claims can be firm. Scientific claims are hedged to what the data shows; label preliminary results as preliminary.
- Lowlights get the same plain language as wins. State what slipped, why, and what changes. Never soften with "unfortunately" or turn a lowlight into a boast.
- Define a technical term or pathogen once at first use, in parentheses, then use the short form.
- Prefer "we did X" to "we have initiated a workflow to"; say what work unlocks, not just that it started.
- Terms: bacteriocins, CinThesis, Organicin-VG, SOW and SOWs (no apostrophe), TL;DR, Lowlights, research collaboration, channel partner, field trial or lab trial (say which).
- Never write: "state of the art", "world's most extensive", "best-in-class", "very very", ALL CAPS for emphasis, em dashes, exclamation marks.
- No jokes or asides; the author adds those.`;

export async function generatePromptFills(opts: {
  doc: DocNode;
  notes: string;
  source: SourceAttachment | null;
}): Promise<Map<number, string>> {
  if (!aiDraftConfigured()) {
    throw badRequest("AI drafting is not enabled. Set AI_DRAFT_ENABLED=true and configure Vertex credentials.");
  }

  const prompts = listTemplatePrompts(opts.doc);
  if (prompts.length === 0) {
    throw badRequest("There are no template prompts left to fill in this update.");
  }

  const credentials = vertexServiceAccount();
  if (!credentials) throw badRequest("Vertex credentials are not configured.");

  const e = env();
  const location = e.VERTEX_GEMINI_LOCATION || DEFAULT_VERTEX_LOCATION;
  const modelId = e.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  const vertex = new VertexAI({
    project: e.FIREBASE_PROJECT_ID,
    location,
    googleAuthOptions: { credentials },
  });

  const model = vertex.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          fills: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER },
                text: { type: SchemaType.STRING },
              },
              required: ["id", "text"],
            },
          },
        },
        required: ["fills"],
      },
    },
  });

  const promptCatalog = prompts
    .map((p) => `- id ${p.id} (${p.kind}): ${p.instruction}`)
    .join("\n");

  const userText = [
    STYLE_RULES,
    "",
    "Template prompts to fill (use id when returning fills):",
    promptCatalog,
    "",
    opts.notes.trim() ? `Author notes:\n${opts.notes.trim()}` : "Author notes: (none)",
    opts.source?.kind === "text" ? `\nSource document (${opts.source.filename}):\n${opts.source.text}` : "",
    opts.source?.kind === "pdf"
      ? `\nA PDF source document (${opts.source.filename}) is attached. Use it as the primary factual source.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts: Part[] = [{ text: userText }];
  if (opts.source?.kind === "pdf") {
    parts.push({ inlineData: { mimeType: opts.source.mimeType, data: opts.source.base64 } });
  }

  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
  });

  const text =
    result.response.candidates?.[0]?.content?.parts
      ?.map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";

  if (!text.trim()) throw badRequest("Gemini returned an empty response. Try again or shorten the source material.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Gemini returned invalid JSON. Try again.");
  }

  const validated = fillsResponseSchema.safeParse(parsed);
  if (!validated.success) throw badRequest("Gemini returned an unexpected response shape. Try again.");

  const knownIds = new Set(prompts.map((p) => p.id));
  const map = new Map<number, string>();
  for (const fill of validated.data.fills) {
    if (!knownIds.has(fill.id)) continue;
    const value = fill.text.trim();
    if (value) map.set(fill.id, value);
  }
  return map;
}
