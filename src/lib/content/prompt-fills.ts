import type { DocNode } from "./schema";
import { PROMPT_OPEN, templatePromptCount } from "./template";

/** Matches a full `[Write: …]` placeholder (instruction may contain commas). */
const PROMPT_RE = /\[Write: ([^\]]+)\]/g;

export type PromptKind = "inline" | "metric";

export type ListedPrompt = {
  id: number;
  instruction: string;
  kind: PromptKind;
};

type Walkable = {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: { items?: { value?: string }[] };
  content?: unknown[];
};

function cloneDoc(doc: DocNode): DocNode {
  return JSON.parse(JSON.stringify(doc)) as DocNode;
}

/** List every unfilled template prompt in document order (text nodes and metric values). */
export function listTemplatePrompts(doc: DocNode): ListedPrompt[] {
  const out: ListedPrompt[] = [];
  let id = 0;

  const scanText = (text: string, kind: PromptKind) => {
    PROMPT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROMPT_RE.exec(text)) !== null) {
      out.push({ id: id++, instruction: m[1]!, kind });
    }
  };

  const walk = (nodes: unknown[] | undefined) => {
    for (const raw of nodes ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as Walkable;
      if (node.type === "text" && typeof node.text === "string") scanText(node.text, "inline");
      if (node.type === "metrics" && Array.isArray(node.attrs?.items)) {
        for (const item of node.attrs.items) {
          if (typeof item?.value === "string") scanText(item.value, "metric");
        }
      }
      if (Array.isArray(node.content)) walk(node.content);
    }
  };

  walk(doc.content);
  return out;
}

export type ApplyPromptFillsResult = {
  doc: DocNode;
  filled: number;
  remainingPrompts: number;
};

/** Replace `[Write: …]` placeholders with drafted text; unknown ids keep the placeholder. */
export function applyPromptFills(doc: DocNode, fillsById: ReadonlyMap<number, string>): ApplyPromptFillsResult {
  const next = cloneDoc(doc);
  let id = 0;
  let filled = 0;

  const replaceInString = (text: string, kind: PromptKind): string => {
    return text.replace(PROMPT_RE, (full) => {
      const raw = fillsById.get(id);
      id += 1;
      if (raw === undefined) return full;
      let value = raw.trim();
      if (!value) return full;
      if (kind === "metric" && value.length > 40) value = value.slice(0, 40);
      filled += 1;
      return value;
    });
  };

  const walk = (nodes: unknown[] | undefined, inMetricsValue = false) => {
    for (const raw of nodes ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as Walkable;

      if (node.type === "text" && typeof node.text === "string") {
        const kind: PromptKind = inMetricsValue ? "metric" : "inline";
        const updated = replaceInString(node.text, kind);
        if (updated !== node.text) {
          node.text = updated;
          if (!updated.includes(PROMPT_OPEN)) {
            node.marks = node.marks?.filter((m) => m.type !== "italic");
          }
        }
      }

      if (node.type === "metrics" && Array.isArray(node.attrs?.items)) {
        for (const item of node.attrs.items) {
          if (typeof item?.value === "string") {
            const updated = replaceInString(item.value, "metric");
            if (updated !== item.value) item.value = updated;
          }
        }
      }

      if (Array.isArray(node.content)) walk(node.content, inMetricsValue);
    }
  };

  walk(next.content);
  return { doc: next, filled, remainingPrompts: templatePromptCount(next) };
}
