import "server-only";
import type { DocNode } from "@/lib/content/schema";
import { applyPromptFills, listTemplatePrompts } from "@/lib/content/prompt-fills";
import { parseDoc } from "@/lib/content/schema";
import { badRequest } from "../http/errors";
import { generatePromptFills } from "./gemini-draft";
import type { SourceAttachment } from "./source-text";

export type DraftUpdateResult = {
  content: DocNode;
  filled: number;
  remainingPrompts: number;
  promptCount: number;
};

export async function draftUpdateFromSource(opts: {
  doc: DocNode;
  notes: string;
  source: SourceAttachment | null;
}): Promise<DraftUpdateResult> {
  const promptCount = listTemplatePrompts(opts.doc).length;
  const fills = await generatePromptFills(opts);
  const applied = applyPromptFills(opts.doc, fills);
  const validated = parseDoc(applied.doc);
  if (!validated.ok) throw badRequest(validated.error);

  return {
    content: validated.doc,
    filled: applied.filled,
    remainingPrompts: applied.remainingPrompts,
    promptCount,
  };
}
