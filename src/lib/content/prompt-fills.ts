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

/** Normalised form of a prompt's instruction, for matching the same prompt across texts. */
export function promptKey(instruction: string): string {
  return instruction.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every `[Write: …]` instruction in a piece of text, as keys (see `promptKey`). */
export function promptKeysIn(text: string): Set<string> {
  const keys = new Set<string>();
  for (const m of text.matchAll(PROMPT_RE)) keys.add(promptKey(m[1]!));
  return keys;
}

/**
 * Remove the `[Write: …]` placeholders the model typed itself. A placeholder listed in
 * `keep` came from the author's own material, a gap only they can fill, so it stays where
 * the model put it and the send check still holds the update until it is filled.
 */
export function stripPromptMarkers(text: string, keep: ReadonlySet<string> = new Set()): string {
  return text
    .replace(PROMPT_RE, (full, instruction: string) => (keep.has(promptKey(instruction)) ? full : ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
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
 * A fill can carry `**bold**`, as the model writes bold everywhere else. Split such text
 * nodes into plain and bold runs so the asterisks never reach investors.
 */
function boldRuns(nodes: unknown[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Walkable | undefined;
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node.content)) boldRuns(node.content);
    if (node.type !== "text" || typeof node.text !== "string" || !/\*\*[^*]+\*\*/.test(node.text)) continue;
    const base = (node.marks ?? []).filter((m) => m.type !== "bold");
    const runs: Walkable[] = [];
    const push = (text: string, bold: boolean) => {
      if (!text) return;
      const marks = bold ? [...base, { type: "bold" }] : base;
      runs.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
    };
    let last = 0;
    for (const m of node.text.matchAll(/\*\*([^*]+)\*\*/g)) {
      push(node.text.slice(last, m.index), false);
      push(m[1]!, true);
      last = m.index! + m[0].length;
    }
    push(node.text.slice(last), false);
    nodes.splice(i, 1, ...runs);
    i += runs.length - 1;
  }
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
        if (kind === "metric") {
          const plain = value.replace(/\*\*/g, "");
          return plain.length > 40 ? plain.slice(0, 40) : plain;
        }
        return value;
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
  if (filled > 0) boldRuns(next.content as unknown[]);

  if (removed > 0) {
    const before = next.content as unknown[];
    const pruned = pruneAfterRemoval(before, touched).out;
    const content = dropOrphanLabels(before, pruned) as DocNode["content"];
    next.content = content.length ? content : [{ type: "paragraph" }];
  }

  return { doc: next, filled, removed, remainingPrompts: templatePromptCount(next) };
}
