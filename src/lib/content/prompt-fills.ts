import type { DocNode } from "./schema";
import { PROMPT_OPEN, templatePromptCount } from "./template";

/** Matches a full `[Write: …]` placeholder (instruction may contain commas). */
const PROMPT_RE = /\[Write: ([^\]]+)\]/g;

export type PromptKind = "inline" | "metric";

export type ListedPrompt = {
  id: number;
  instruction: string;
  kind: PromptKind;
  /** The template marks a prompt optional by starting its instruction with "optional". */
  optional: boolean;
};

type Walkable = {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: { items?: { label?: string; value?: string }[] };
  content?: unknown[];
};

function cloneDoc(doc: DocNode): DocNode {
  return JSON.parse(JSON.stringify(doc)) as DocNode;
}

function isOptional(instruction: string): boolean {
  return /^\s*optional\b/i.test(instruction);
}

/** List every unfilled template prompt in document order (text nodes and metric values). */
export function listTemplatePrompts(doc: DocNode): ListedPrompt[] {
  const out: ListedPrompt[] = [];
  let id = 0;

  const scanText = (text: string, kind: PromptKind) => {
    PROMPT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROMPT_RE.exec(text)) !== null) {
      out.push({ id: id++, instruction: m[1]!, kind, optional: isOptional(m[1]!) });
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

/** Remove every `[Write: …]` placeholder from a string the model wrote itself. */
export function stripPromptMarkers(text: string): string {
  return text
    .replace(PROMPT_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type ApplyPromptFillsResult = {
  doc: DocNode;
  filled: number;
  removed: number;
  remainingPrompts: number;
};

const TEXT_BLOCKS = new Set(["paragraph", "heading", "pullQuote"]);
const LIST_BLOCKS = new Set(["bulletList", "orderedList"]);
const WRAPPER_BLOCKS = new Set(["listItem", "blockquote", "callout"]);

type Inline = { type?: string; text?: string; marks?: { type: string }[] };

function visibleText(content: unknown[] | undefined): string {
  return (content ?? [])
    .map((n) => {
      const node = n as Inline;
      return node.type === "text" && typeof node.text === "string" ? node.text : "";
    })
    .join("")
    .trim();
}

/** A paragraph that is only a bold label, such as "Research collaborations" or "TL;DR". */
function isLabelOnly(content: unknown[] | undefined): boolean {
  const texts = (content ?? []).filter((n) => (n as Inline).type === "text" && (n as Inline).text?.trim()) as Inline[];
  return texts.length > 0 && texts.every((n) => n.marks?.some((m) => m.type === "bold"));
}

/**
 * After a prompt is removed, a block can be left with nothing to say: an empty bullet,
 * a "Cost per candidate:" lead-in with no figure, a bold "TL;DR" with no summary.
 * Prune those, but only where a removal happened, so untouched empty paragraphs stay.
 */
function pruneAfterRemoval(nodes: unknown[], touched: WeakSet<object>): { out: unknown[]; dropped: boolean } {
  const out: unknown[] = [];
  let dropped = false;
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") {
      out.push(raw);
      continue;
    }
    const node = raw as Walkable;

    if (node.type === "text") {
      if (touched.has(node) && !node.text?.trim()) {
        dropped = true;
        continue;
      }
      out.push(node);
      continue;
    }

    if (node.type === "metrics" && touched.has(node)) {
      const items = (node.attrs?.items ?? []).filter((it) => !touched.has(it as object));
      if (!items.length) {
        dropped = true;
        continue;
      }
      node.attrs = { ...node.attrs, items };
      out.push(node);
      continue;
    }

    if (Array.isArray(node.content)) {
      const inner = pruneAfterRemoval(node.content, touched);
      node.content = inner.out;
      const changed = inner.dropped || touched.has(node);
      if (changed && node.type && TEXT_BLOCKS.has(node.type)) {
        const text = visibleText(node.content);
        if (!text || text.endsWith(":") || isLabelOnly(node.content)) {
          dropped = true;
          continue;
        }
        // Tidy the space a removed prompt leaves behind, e.g. "**TL;DR** " at the end.
        const last = node.content[node.content.length - 1] as Inline | undefined;
        if (last?.type === "text" && typeof last.text === "string") last.text = last.text.replace(/\s+$/, "");
      }
      if (changed && node.type && (LIST_BLOCKS.has(node.type) || WRAPPER_BLOCKS.has(node.type)) && !node.content.length) {
        dropped = true;
        continue;
      }
    }
    out.push(node);
  }
  return { out, dropped };
}

/**
 * Drop a bold sub-label paragraph ("Products") whose list was removed in this pass, so
 * the update doesn't keep a label with nothing under it.
 */
function dropOrphanLabels(before: unknown[], after: unknown[]): unknown[] {
  const kept = new Set(after);
  const result: unknown[] = [];
  for (let i = 0; i < before.length; i++) {
    const node = before[i] as Walkable;
    if (!kept.has(node)) continue;
    const isLabel = node.type === "paragraph" && isLabelOnly(node.content);
    if (isLabel) {
      const nextOriginal = before[i + 1];
      const sectionRemoved = nextOriginal !== undefined && !kept.has(nextOriginal);
      let j = i + 1;
      while (j < before.length && !kept.has(before[j])) j++;
      // A sub-label introduces a list. With its list gone and no other list after it, it has nothing left to label.
      const next = before[j] as Walkable | undefined;
      const labelsAList = next?.type === "bulletList" || next?.type === "orderedList";
      if (sectionRemoved && !labelsAList) continue;
    }
    result.push(node);
  }
  return result;
}

/**
 * Replace `[Write: …]` placeholders with drafted text, and remove the ones in `removeIds`
 * (prompts the material doesn't support). Unknown ids keep the placeholder.
 * A removed metric prompt takes its whole card with it.
 */
export function applyPromptFills(
  doc: DocNode,
  fillsById: ReadonlyMap<number, string>,
  removeIds: ReadonlySet<number> = new Set(),
): ApplyPromptFillsResult {
  const next = cloneDoc(doc);
  let id = 0;
  let filled = 0;
  let removed = 0;
  const touched = new WeakSet<object>();

  const replaceInString = (text: string, kind: PromptKind, onRemove: () => void): string => {
    return text.replace(PROMPT_RE, (full) => {
      const current = id;
      id += 1;
      const raw = fillsById.get(current);
      const value = raw?.trim();
      if (value) {
        filled += 1;
        return kind === "metric" && value.length > 40 ? value.slice(0, 40) : value;
      }
      if (removeIds.has(current)) {
        removed += 1;
        onRemove();
        return "";
      }
      return full;
    });
  };

  const walk = (nodes: unknown[] | undefined, parents: object[]) => {
    for (const raw of nodes ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as Walkable;

      if (node.type === "text" && typeof node.text === "string") {
        let removedHere = false;
        const updated = replaceInString(node.text, "inline", () => (removedHere = true));
        if (updated !== node.text) {
          node.text = updated;
          if (!updated.includes(PROMPT_OPEN)) node.marks = node.marks?.filter((m) => m.type !== "italic");
          if (node.marks && !node.marks.length) delete node.marks;
          if (removedHere) {
            touched.add(node);
            parents.forEach((p) => touched.add(p));
          }
        }
      }

      if (node.type === "metrics" && Array.isArray(node.attrs?.items)) {
        for (const item of node.attrs.items) {
          if (typeof item?.value !== "string") continue;
          let removedHere = false;
          const updated = replaceInString(item.value, "metric", () => (removedHere = true));
          if (updated !== item.value) item.value = updated;
          if (removedHere) {
            touched.add(item);
            touched.add(node);
          }
        }
      }

      if (Array.isArray(node.content)) walk(node.content, [...parents, node]);
    }
  };

  walk(next.content, []);

  if (removed > 0) {
    const before = next.content as unknown[];
    const pruned = pruneAfterRemoval(before, touched).out;
    const content = dropOrphanLabels(before, pruned) as DocNode["content"];
    next.content = content.length ? content : [{ type: "paragraph" }];
  }

  return { doc: next, filled, removed, remainingPrompts: templatePromptCount(next) };
}
