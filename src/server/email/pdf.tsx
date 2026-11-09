import "server-only";
import path from "node:path";
import * as React from "react";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_GOLD } from "@/lib/brand";
import type { BlockNode, DocNode, InlineNode } from "@/lib/content/schema";
import type { AppSettings } from "@/lib/types";
import { loadAssetBuffers } from "../storage";
import { DEFAULT_LEAF_PNG, DEFAULT_LOGO_PNG } from "./default-logo";

type ImageMap = Map<string, { buf: Buffer; mime: string }>;

interface Faces {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
  black: string;
}

interface Ctx {
  color: string;
  text: string;
  images: ImageMap;
  f: Faces;
}

const HELVETICA: Faces = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  black: "Helvetica-Bold",
};

/**
 * Nunito Sans, the brand typeface, read from src/fonts. next.config.ts ships that folder to the
 * API functions through outputFileTracingIncludes. Registered once per process.
 */
const NUNITO: Faces = {
  regular: "NunitoSans",
  bold: "NunitoSans-Bold",
  italic: "NunitoSans-Italic",
  boldItalic: "NunitoSans-BoldItalic",
  black: "NunitoSans-Black",
};
let nunitoRegistered = false;
function registerNunito() {
  if (nunitoRegistered) return;
  const dir = path.join(process.cwd(), "src", "fonts");
  const files: [string, string][] = [
    [NUNITO.regular, "nunito-sans-latin-400-normal.woff"],
    [NUNITO.bold, "nunito-sans-latin-700-normal.woff"],
    [NUNITO.italic, "nunito-sans-latin-400-italic.woff"],
    [NUNITO.boldItalic, "nunito-sans-latin-700-italic.woff"],
    [NUNITO.black, "nunito-sans-latin-900-normal.woff"],
  ];
  for (const [family, file] of files) Font.register({ family, src: path.join(dir, file) });
  Font.registerHyphenationCallback((word) => [word]);
  nunitoRegistered = true;
}

const MUTED = "#6b7280";
const BORDER = "#e5e7eb";

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 56, fontSize: 10.5, lineHeight: 1.55 },
  para: { marginBottom: 8 },
  footer: { position: "absolute", bottom: 28, left: 56, right: 56, fontSize: 8, color: MUTED, textAlign: "center" },
});

function pdfImage(images: ImageMap, id: string | null) {
  if (!id) return null;
  const img = images.get(id);
  if (!img) return null;
  // react-pdf only embeds PNG and JPEG.
  if (img.mime === "image/png") return { data: img.buf, format: "png" as const };
  if (img.mime === "image/jpeg") return { data: img.buf, format: "jpg" as const };
  return null;
}

function Inline({ nodes, ctx }: { nodes?: InlineNode[]; ctx: Ctx }) {
  if (!nodes?.length) return <Text> </Text>;
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "hardBreak") return <Text key={i}>{"\n"}</Text>;
        const marks = n.marks ?? [];
        const bold = marks.some((m) => m.type === "bold");
        const italic = marks.some((m) => m.type === "italic");
        const style = {
          fontFamily: bold && italic ? ctx.f.boldItalic : bold ? ctx.f.bold : italic ? ctx.f.italic : ctx.f.regular,
          textDecoration: marks.some((m) => m.type === "underline")
            ? ("underline" as const)
            : marks.some((m) => m.type === "strike")
              ? ("line-through" as const)
              : undefined,
          color: (marks.find((m) => m.type === "textStyle") as { attrs?: { color?: string | null } } | undefined)?.attrs?.color ?? undefined,
        };
        const link = marks.find((m) => m.type === "link");
        if (link && link.type === "link") {
          return (
            <Link key={i} src={link.attrs.href} style={{ ...style, color: ctx.color, textDecoration: "underline" }}>
              {n.text}
            </Link>
          );
        }
        return (
          <Text key={i} style={style}>
            {n.text}
          </Text>
        );
      })}
    </>
  );
}

function Block({ node, ctx, tight }: { node: BlockNode; ctx: Ctx; tight?: boolean }): React.ReactElement | null {
  switch (node.type) {
    case "paragraph":
      return (
        <Text style={{ ...s.para, marginBottom: tight ? 2 : 8, textAlign: node.attrs?.textAlign ?? "left", color: ctx.text }}>
          <Inline nodes={node.content} ctx={ctx} />
        </Text>
      );
    case "heading": {
      const size = { 1: 18, 2: 13.5, 3: 12 }[node.attrs.level];
      return (
        <Text
          style={{
            fontFamily: ctx.f.bold,
            fontSize: size,
            marginTop: node.attrs.level === 1 ? 4 : 12,
            marginBottom: 6,
            color: node.attrs.level === 1 ? ctx.color : ctx.text,
            textAlign: node.attrs.textAlign ?? "left",
          }}
        >
          <Inline nodes={node.content} ctx={{ ...ctx, f: { ...ctx.f, regular: ctx.f.bold, italic: ctx.f.boldItalic } }} />
        </Text>
      );
    }
    case "pullQuote":
      return (
        <Text style={{ ...s.para, fontFamily: ctx.f.italic, fontSize: 12.5, textAlign: "center", color: ctx.color, paddingHorizontal: 18, marginBottom: 12 }}>
          <Inline nodes={node.content} ctx={{ ...ctx, f: { ...ctx.f, regular: ctx.f.italic, bold: ctx.f.boldItalic } }} />
        </Text>
      );
    case "bulletList":
    case "orderedList": {
      const start = node.type === "orderedList" ? (node.attrs?.start ?? 1) : 1;
      return (
        <View style={{ marginBottom: 8 }}>
          {node.content.map((li, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 4 }} wrap={false}>
              {node.type === "orderedList" ? (
                <Text style={{ width: 18, color: ctx.text }}>{`${start + i}.`}</Text>
              ) : (
                <View style={{ width: 16, paddingTop: 4.2 }}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image src={{ data: DEFAULT_LEAF_PNG, format: "png" }} style={{ width: 7.5, height: 7.5 }} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                {li.content.map((c, j) => (
                  <Block key={j} node={c} ctx={ctx} tight />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "blockquote":
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: BORDER, paddingLeft: 10, marginBottom: 8 }}>
          {node.content.map((c, i) => (
            <Block key={i} node={c} ctx={ctx} />
          ))}
        </View>
      );
    case "callout":
      return (
        <View
          style={{ backgroundColor: "#f3f4f6", borderLeftWidth: 2, borderLeftColor: ctx.color, padding: 10, paddingBottom: 4, marginBottom: 10 }}
          wrap={false}
        >
          {node.content.map((c, i) => (
            <Block key={i} node={c} ctx={ctx} />
          ))}
        </View>
      );
    case "metrics": {
      const anySublabel = node.attrs.items.some((m) => m.sublabel);
      return (
        <View style={{ flexDirection: "row", marginTop: 4, marginBottom: 14 }} wrap={false}>
          {node.attrs.items.map((m, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 8, fontFamily: ctx.f.black, letterSpacing: 0.6, color: ctx.text, textAlign: "center" }}>
                {m.label.toUpperCase()}
              </Text>
              {anySublabel ? <Text style={{ fontSize: 7, color: MUTED, textAlign: "center" }}>{m.sublabel || " "}</Text> : null}
              <Text style={{ fontSize: 15, fontFamily: ctx.f.bold, color: ctx.color, marginTop: 4 }}>{m.value}</Text>
            </View>
          ))}
        </View>
      );
    }
    case "image": {
      const src = pdfImage(ctx.images, node.attrs.assetId);
      if (!src) {
        return node.attrs.alt ? <Text style={{ ...s.para, color: MUTED }}>[Image: {node.attrs.alt}]</Text> : null;
      }
      const width = Math.min(node.attrs.width ?? 480, 480);
      const align = node.attrs.align === "left" ? "flex-start" : node.attrs.align === "right" ? "flex-end" : "center";
      return (
        <View style={{ alignItems: align, marginBottom: 10 }} wrap={false}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={src} style={{ width }} />
        </View>
      );
    }
    case "horizontalRule":
      return (
        <View style={{ alignItems: "center", marginTop: 2, marginBottom: 12 }}>
          <View
            style={{
              width: node.attrs?.variant === "short" ? 160 : "100%",
              borderTopWidth: 0.75,
              borderTopColor: node.attrs?.variant === "short" ? ctx.text : BORDER,
            }}
          />
        </View>
      );
    case "table":
      return (
        <View style={{ borderWidth: 0.75, borderColor: BORDER, marginBottom: 10 }}>
          {node.content.map((row, r) => (
            <View key={r} style={{ flexDirection: "row" }} wrap={false}>
              {row.content.map((cell, c) => (
                <View
                  key={c}
                  style={{
                    flex: cell.attrs?.colspan ?? 1,
                    borderWidth: 0.5,
                    borderColor: BORDER,
                    padding: 5,
                    paddingBottom: 0,
                    backgroundColor: cell.type === "tableHeader" ? "#f9fafb" : "#ffffff",
                  }}
                >
                  {cell.content.map((b, i) => (
                    <Block key={i} node={b} ctx={ctx} tight />
                  ))}
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export interface PdfInput {
  title: string;
  content: DocNode;
  bannerAssetId: string | null;
  settings: AppSettings;
  dateLabel: string;
}

function collectIds(input: PdfInput): string[] {
  const ids: string[] = [];
  if (input.settings.branding.logoAssetId) ids.push(input.settings.branding.logoAssetId);
  if (input.bannerAssetId) ids.push(input.bannerAssetId);
  const walk = (nodes: unknown[]) => {
    for (const raw of nodes) {
      const n = raw as { type: string; attrs?: { assetId?: string }; content?: unknown[] };
      if (n.type === "image" && n.attrs?.assetId) ids.push(n.attrs.assetId);
      if (Array.isArray(n.content)) walk(n.content);
    }
  };
  walk(input.content.content);
  return ids;
}

export async function renderUpdatePdf(input: PdfInput): Promise<Buffer> {
  const images = await loadAssetBuffers(collectIds(input));
  const b = input.settings.branding;
  const f = b.fontFamily === "nunito" ? NUNITO : HELVETICA;
  if (f === NUNITO) registerNunito();
  const ctx: Ctx = { color: b.primaryColor, text: b.textColor, images, f };
  const logo = b.logoAssetId ? pdfImage(images, b.logoAssetId) : { data: DEFAULT_LOGO_PNG, format: "png" as const };
  const banner = pdfImage(images, input.bannerAssetId);
  const doc = (
    <Document title={input.title} author={b.companyName} creator={b.companyName} producer={b.companyName}>
      <Page size="LETTER" style={{ ...s.page, fontFamily: f.regular }}>
        <View style={{ alignItems: "center", marginBottom: 14 }}>
          {logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logo} style={{ width: 200 }} />
          ) : (
            <Text style={{ fontFamily: f.black, fontSize: 20, letterSpacing: 1, color: b.primaryColor }}>
              {b.companyName.toUpperCase()}
            </Text>
          )}
          <View style={{ width: 36, borderTopWidth: 1.5, borderTopColor: BRAND_GOLD, marginTop: 10 }} />
          <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 6 }}>{input.dateLabel}</Text>
        </View>
        {banner ? (
          <View style={{ alignItems: "center", marginBottom: 12 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={banner} style={{ width: 480 }} />
          </View>
        ) : null}
        {input.content.content.map((node, i) => (
          <Block key={i} node={node} ctx={ctx} />
        ))}
        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${b.companyName} · Confidential — for intended recipients only · ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
