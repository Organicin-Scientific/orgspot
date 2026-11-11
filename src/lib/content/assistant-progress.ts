import { listTemplatePrompts } from "./prompt-fills";
import type { DocNode } from "./schema";

/**
 * Live progress for an assistant turn. The server streams these as newline-delimited JSON;
 * the chat shows the latest `step` label in its ticker.
 */
export type AssistantStreamEvent =
  | { type: "step"; label: string }
  | { type: "done"; result: unknown }
  | { type: "error"; status: number; message: string };

export const MAX_STEP_LABEL = 72;

export function clampLabel(label: string): string {
  const one = label.replace(/\s+/g, " ").trim();
  return one.length > MAX_STEP_LABEL ? `${one.slice(0, MAX_STEP_LABEL - 1).trimEnd()}…` : one;
}

// ---------------------------------------------------------------------------
// Scanning Gemini's JSON while it streams

export type ScanHit = { kind: "reply" } | { kind: "fill" | "edit"; value: unknown };

/**
 * Reads the response JSON (`{ reply, fills: [...], edits: [...] }`) chunk by chunk and reports
 * each fill or edit object the moment its closing brace arrives, plus when the reply starts.
 * It tracks strings and escapes, so braces inside text never count.
 */
export class ResponseScanner {
  private buf = "";
  private pos = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringStart = -1;
  private lastKey: string | null = null;
  private arrayName: string | null = null;
  private objectStart = -1;
  private sawReply = false;

  get text(): string {
    return this.buf;
  }

  push(chunk: string): ScanHit[] {
    this.buf += chunk;
    const hits: ScanHit[] = [];
    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos]!;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          if (this.depth === 1) {
            this.lastKey = this.buf.slice(this.stringStart + 1, this.pos);
            if (this.lastKey === "reply" && !this.sawReply) {
              this.sawReply = true;
              hits.push({ kind: "reply" });
            }
          }
        }
        continue;
      }
      if (ch === '"') {
        this.inString = true;
        this.stringStart = this.pos;
      } else if (ch === "{" || ch === "[") {
        this.depth++;
        if (ch === "[" && this.depth === 2) this.arrayName = this.lastKey;
        if (ch === "{" && this.depth === 3 && (this.arrayName === "fills" || this.arrayName === "edits")) {
          this.objectStart = this.pos;
        }
      } else if (ch === "}" || ch === "]") {
        if (ch === "}" && this.depth === 3 && this.objectStart >= 0) {
          try {
            const value: unknown = JSON.parse(this.buf.slice(this.objectStart, this.pos + 1));
            hits.push({ kind: this.arrayName === "fills" ? "fill" : "edit", value });
          } catch {
            // A malformed object is caught by the full parse at the end; skip its label.
          }
          this.objectStart = -1;
        }
        if (ch === "]" && this.depth === 2) this.arrayName = null;
        this.depth--;
      }
    }
    return hits;
  }
}

// ---------------------------------------------------------------------------
// Thought summaries

/**
 * Gemini thought summaries open with a bold headline ("**Mapping the notes to the TL;DR**").
 * Returns every complete headline in the accumulated thought text.
 */
export function thoughtHeadlines(text: string): string[] {
  const out: string[] = [];
  const re = /\*\*([^*\n]{3,120})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(clampLabel(m[1]!));
  return out;
}

// ---------------------------------------------------------------------------
// Naming the part of the update a change touches

type Walk = { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] };

function textOf(node: unknown): string {
  const n = node as Walk;
  if (typeof n.text === "string") return n.text;
  return (n.content ?? []).map(textOf).join(" ");
}

/** Leading bold run of a paragraph, such as "TL;DR". */
function boldLead(node: unknown): string | null {
  const first = (node as Walk).content?.[0] as Walk | undefined;
  if (first?.type === "text" && first.marks?.some((mk) => mk.type === "bold")) {
    const t = (first.text ?? "").replace(/[:\s]+$/, "").trim();
    return t || null;
  }
  return null;
}

/** A short human name for the block at `index`: its bold lead, else the section heading above it. */
export function sectionName(doc: DocNode, index: number): string {
  const blocks = doc.content as unknown[];
  const at = blocks[index] as Walk | undefined;
  if (at?.type === "heading") return clampLabel(textOf(at)) || "a heading";
  if (at?.type === "paragraph") {
    const lead = boldLead(at);
    if (lead) return clampLabel(lead);
  }
  for (let i = Math.min(index, blocks.length - 1); i >= 0; i--) {
    const b = blocks[i] as Walk;
    if (b.type === "heading") {
      const t = textOf(b).trim();
      if (t) return clampLabel(t);
    }
  }
  if (at?.type === "pullQuote") return "the opening quote";
  return "the opening";
}

/** Maps each template prompt id to the top-level block it sits in. */
export function promptBlockIndex(doc: DocNode): Map<number, number> {
  const map = new Map<number, number>();
  let id = 0;
  doc.content.forEach((block, i) => {
    const count = listTemplatePrompts({ type: "doc", content: [block] } as DocNode).length;
    for (let k = 0; k < count; k++) map.set(id++, i);
  });
  return map;
}

export function describeHit(hit: ScanHit, doc: DocNode, prompts: Map<number, number>): string | null {
  if (hit.kind === "reply") return "Writing the reply";
  const v = hit.value as { id?: unknown; op?: unknown; index?: unknown; type?: unknown };
  if (hit.kind === "fill") {
    const block = typeof v.id === "number" ? prompts.get(v.id) : undefined;
    return block === undefined ? null : clampLabel(`Drafted ${sectionName(doc, block)}`);
  }
  if (typeof v.index !== "number") return null;
  if (v.op === "insert_after") {
    return clampLabel(v.index < 0 ? "Added a block at the top" : `Added to ${sectionName(doc, v.index)}`);
  }
  if (v.index < 0 || v.index >= doc.content.length) return null;
  const where = sectionName(doc, v.index);
  if (v.op === "delete") return clampLabel(`Removed a block from ${where}`);
  if (v.op === "replace") return clampLabel(`Rewrote ${where}`);
  return null;
}
