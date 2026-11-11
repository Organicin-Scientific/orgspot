"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Link from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { RotateCcw } from "lucide-react";
import { CALLOUT_TONES, isSafeHref, type CalloutTone, type MetricItem } from "@/lib/content/schema";
import { isStandingMetrics, STANDING_METRICS } from "@/lib/content/template";
import { cn } from "@/lib/utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    customBlocks: {
      insertMetrics: () => ReturnType;
      insertPullQuote: () => ReturnType;
      insertCallout: (tone?: CalloutTone) => ReturnType;
      insertDivider: (variant: "full" | "short") => ReturnType;
      insertAssetImage: (attrs: { assetId: string; alt?: string }) => ReturnType;
    };
  }
}

/* ---------------- Metrics row ---------------- */

function MetricsView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const items = (node.attrs.items as MetricItem[]) ?? [];
  const editable = editor.isEditable;
  const standard = isStandingMetrics(items);
  const setValue = (i: number, value: string) =>
    updateAttributes({ items: items.map((it, j) => (j === i ? { ...it, value } : it)) });

  // Labels and basis lines are fixed (see STANDING_METRICS) so the strip stays comparable
  // quarter to quarter. Only values are editable here.
  return (
    <NodeViewWrapper
      className={cn("my-4 rounded-md", selected && "ring-2 ring-[var(--doc-brand)] ring-offset-2")}
      data-type="metrics"
      contentEditable={false}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it, i) => (
          <div
            key={i}
            className="rounded-[10px] border border-[#e3e8e6] bg-[#f6f8f7] px-3 pt-4 pb-3.5 text-center transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-[var(--doc-brand)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--doc-brand)_14%,transparent)]"
          >
            <MetricInput
              value={it.value}
              placeholder="Value"
              disabled={!editable}
              className="text-[26px] font-bold leading-tight tracking-[-0.01em] tabular-nums text-[var(--doc-brand)]"
              maxLength={40}
              onChange={(v) => setValue(i, v)}
              ariaLabel={`${it.label || `Metric ${i + 1}`} value`}
            />
            <p className="mt-1.5 select-none text-[13px] font-semibold">{it.label}</p>
            {it.sublabel ? <p className="mt-px select-none text-[12px] text-[#6b7280]">{it.sublabel}</p> : null}
          </div>
        ))}
      </div>
      {editable && !standard && (
        <div className="mt-1.5 flex justify-end font-sans text-xs text-[#666]">
          <button
            type="button"
            className="pressable inline-flex items-center gap-1 rounded px-1.5 py-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#eef1f0]"
            onClick={() => updateAttributes({ items: standingItems() })}
          >
            <RotateCcw className="size-3" /> Use standard metrics
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** A fresh standing strip with empty values. */
function standingItems(): MetricItem[] {
  return STANDING_METRICS.map((m) => ({ ...m, value: "" }));
}

function MetricInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  maxLength,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder: string;
  disabled: boolean;
  maxLength: number;
  ariaLabel: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn("block w-full bg-transparent text-center outline-none placeholder:text-[#b5b5b5] disabled:cursor-default", className)}
    />
  );
}

export const Metrics = Node.create({
  name: "metrics",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      items: {
        default: STANDING_METRICS.map((m) => ({ ...m, value: "" })),
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute("data-items") ?? "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ "data-items": JSON.stringify(attrs.items) }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div[data-type="metrics"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "metrics" })],
  addNodeView: () => ReactNodeViewRenderer(MetricsView),
});

/* ---------------- Pull quote ---------------- */

export const PullQuote = Node.create({
  name: "pullQuote",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: 'p[data-type="pull-quote"]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => [
    "p",
    mergeAttributes(HTMLAttributes, {
      "data-type": "pull-quote",
      class: "text-center text-[19px] italic leading-relaxed text-[#4b5563] px-6 my-4",
    }),
    0,
  ],
});

/* ---------------- Callout ---------------- */

const CALLOUT_STYLES: Record<CalloutTone, string> = {
  note: "bg-[#f4f6f5] border-[#c9d3cf]",
  info: "bg-[#eef5fb] border-[#9cc3e4]",
  success: "bg-[#edf7f1] border-[#93cfab]",
  warning: "bg-[#fdf6e9] border-[#e8c27a]",
};

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const tone = node.attrs.tone as CalloutTone;
  return (
    <NodeViewWrapper className={cn("group relative my-4 rounded-md border-l-4 px-4 py-3", CALLOUT_STYLES[tone])} data-type="callout">
      {editor.isEditable && (
        <div contentEditable={false} className="absolute -top-3 right-2 hidden gap-1 rounded-md border bg-white p-0.5 font-sans text-[11px] shadow-sm group-hover:flex">
          {CALLOUT_TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => updateAttributes({ tone: t })}
              className={cn("rounded px-1.5 py-0.5 capitalize text-[#444] hover:bg-[#eef1f0]", t === tone && "bg-[#eef1f0] font-medium")}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <NodeViewContent className="[&>*+*]:mt-2" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    tone: {
      default: "note",
      parseHTML: (el) => {
        const t = el.getAttribute("data-tone");
        return CALLOUT_TONES.includes(t as CalloutTone) ? t : "note";
      },
      renderHTML: (attrs) => ({ "data-tone": attrs.tone }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

/* ---------------- Asset-backed image ---------------- */

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { assetId, alt, width, align } = node.attrs as { assetId: string; alt: string; width: number | null; align: "left" | "center" | "right" };
  const justify = align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center";
  return (
    <NodeViewWrapper className={cn("my-4 flex", justify)} data-type="image">
      <figure className="relative max-w-full" style={{ width: width ? `${width}px` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/assets/${assetId}`}
          alt={alt}
          draggable={false}
          className={cn("block h-auto max-w-full rounded-sm", selected && "outline-2 outline-offset-2 outline-[var(--doc-brand)]")}
          style={{ width: width ? `${width}px` : undefined }}
        />
        {selected && editor.isEditable && (
          <div contentEditable={false} className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-white p-1 font-sans text-[11px] shadow-md">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" onClick={() => updateAttributes({ align: a })} className={cn("rounded px-1.5 py-0.5 capitalize hover:bg-[#eef1f0]", align === a && "bg-[#eef1f0] font-medium")}>
                {a}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[#ddd]" />
            {[
              ["S", 200],
              ["M", 360],
              ["L", 600],
            ].map(([label, w]) => (
              <button key={label} type="button" onClick={() => updateAttributes({ width: w })} className={cn("rounded px-1.5 py-0.5 hover:bg-[#eef1f0]", width === w && "bg-[#eef1f0] font-medium")}>
                {label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[#ddd]" />
            <input
              defaultValue={alt}
              placeholder="Alt text"
              aria-label="Image description (alt text)"
              maxLength={300}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => updateAttributes({ alt: e.target.value })}
              className="w-32 rounded border px-1.5 py-0.5 outline-none"
            />
          </div>
        )}
      </figure>
    </NodeViewWrapper>
  );
}

export const AssetImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    assetId: { default: null, parseHTML: (el) => el.getAttribute("data-asset-id") },
    alt: { default: "" },
    width: {
      default: 600,
      parseHTML: (el) => {
        const w = Number(el.getAttribute("width"));
        return Number.isFinite(w) && w >= 40 && w <= 600 ? w : 600;
      },
    },
    align: { default: "center" },
  }),
  // Only images uploaded to this app (which carry an asset id) survive paste; remote images are dropped.
  parseHTML: () => [{ tag: "img[data-asset-id]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "img",
    mergeAttributes(HTMLAttributes, { "data-asset-id": node.attrs.assetId, src: `/api/assets/${node.attrs.assetId}` }),
  ],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});

/* ---------------- Divider with a "short" accent variant ---------------- */

const Divider = HorizontalRule.extend({
  addAttributes() {
    return {
      variant: {
        default: "full",
        parseHTML: (el) => (el.getAttribute("data-variant") === "short" ? "short" : "full"),
        renderHTML: (attrs) => ({ "data-variant": attrs.variant }),
      },
    };
  },
});

const Commands = Node.create({
  name: "customBlockCommands",
  addCommands() {
    return {
      insertMetrics:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "metrics" }),
      insertPullQuote:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "pullQuote", content: [{ type: "text", text: "A short quote or key message" }] }),
      insertCallout:
        (tone = "note") =>
        ({ commands }) =>
          commands.insertContent({ type: "callout", attrs: { tone }, content: [{ type: "paragraph" }] }),
      insertDivider:
        (variant) =>
        ({ commands }) =>
          commands.insertContent({ type: "horizontalRule", attrs: { variant } }),
      insertAssetImage:
        ({ assetId, alt = "" }) =>
        ({ commands }) =>
          commands.insertContent({ type: "image", attrs: { assetId, alt, width: 600, align: "center" } }),
    };
  },
});

export function editorExtensions(placeholder = "Start writing your update…") {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      // Normalisation transactions on load would otherwise look like user edits.
      trailingNode: false,
    }),
    Divider,
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder, includeChildren: false }),
    Metrics,
    PullQuote,
    Callout,
    AssetImage,
    Commands,
  ];
}
