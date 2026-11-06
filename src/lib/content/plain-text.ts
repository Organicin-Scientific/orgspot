import type { BlockNode, DocNode, InlineNode } from "./schema";

function inlineText(nodes: InlineNode[] | undefined, withLinks: boolean): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      const link = n.marks?.find((m) => m.type === "link");
      if (withLinks && link && link.type === "link" && link.attrs.href !== n.text) {
        return `${n.text} (${link.attrs.href})`;
      }
      return n.text;
    })
    .join("");
}

function blockText(node: BlockNode, indent: string, withLinks: boolean): string {
  switch (node.type) {
    case "paragraph":
      return indent + inlineText(node.content, withLinks);
    case "heading": {
      const text = inlineText(node.content, withLinks);
      return node.attrs.level === 1 ? `${text.toUpperCase()}` : text;
    }
    case "pullQuote":
      return `"${inlineText(node.content, withLinks).replace(/^"|"$/g, "")}"`;
    case "bulletList":
      return node.content
        .map((li) => listItemText(li.content, `${indent}- `, indent + "  ", withLinks))
        .join("\n");
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      return node.content
        .map((li, i) => listItemText(li.content, `${indent}${start + i}. `, indent + "   ", withLinks))
        .join("\n");
    }
    case "blockquote":
    case "callout":
      return node.content.map((c) => blockText(c, indent + "| ", withLinks)).join("\n");
    case "table":
      return node.content
        .map((row) => row.content.map((cell) => cell.content.map((c) => blockText(c, "", withLinks)).join(" ")).join(" | "))
        .join("\n");
    case "metrics":
      return node.attrs.items
        .map((m) => `${m.label}${m.sublabel ? ` (${m.sublabel})` : ""}: ${m.value}`)
        .join("\n");
    case "image":
      return node.attrs.alt ? `[Image: ${node.attrs.alt}]` : "";
    case "horizontalRule":
      return "----------";
  }
}

function listItemText(content: BlockNode[], prefix: string, continuation: string, withLinks: boolean): string {
  return content
    .map((c, i) => {
      const text = blockText(c, "", withLinks);
      return (i === 0 ? prefix : continuation) + text.split("\n").join(`\n${continuation}`);
    })
    .join("\n");
}

/** Plain-text rendering used for the text/plain email part and for search excerpts. */
export function docToPlainText(doc: DocNode, opts: { withLinks?: boolean } = {}): string {
  const withLinks = opts.withLinks ?? true;
  return doc.content
    .map((b) => blockText(b, "", withLinks))
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
}

export function wordCount(doc: DocNode): number {
  const text = docToPlainText(doc, { withLinks: false });
  return text.split(/\s+/).filter(Boolean).length;
}
