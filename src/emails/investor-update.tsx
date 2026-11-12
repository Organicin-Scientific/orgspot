import * as React from "react";
import { Body, Container, Head, Html, Img, Link, Preview } from "@react-email/components";
import { QUOTE_GREY } from "@/lib/brand";
import { CHART_FOOTNOTE, CHART_SIZE, chartAheadFrom, chartAltText, hasChartData, REVENUE_YTD_LABEL, type ChartAhead, type RevenueChart } from "@/lib/content/revenue-chart";
import type { BlockNode, DocNode, InlineNode, Mark, MetricItem } from "@/lib/content/schema";
import { metricDisplayValue } from "@/lib/content/template";

export interface EmailBranding {
  companyName: string;
  logoUrl: string | null;
  /** Leaf bullet image for unordered lists; null falls back to a standard disc. */
  bulletUrl: string | null;
  primaryColor: string;
  textColor: string;
  fontStack: string;
}

export interface EmailModel {
  doc: DocNode;
  previewText: string;
  branding: EmailBranding;
  bannerUrl: string | null;
  resolveImage: (assetId: string) => string;
  /** Static PNG of the Revenue YTD chart. Mail clients run no script, so the chart is an image. */
  chartUrl: (chart: RevenueChart, ahead?: ChartAhead | null) => string;
  pdf: { mode: "attach" | "link" | "none"; url: string | null; filename: string };
  attachments: { name: string; url: string }[];
  footer: { postalAddress: string; note: string; unsubscribeUrl: string; replyTo: string };
  isTest: boolean;
}

const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
/** Matches the metric cards in the editor, so the draft and the sent email look alike. */
const METRIC_BORDER = "#e3e8e6";
const METRIC_RULE = "#eef1f0";
const METRIC_LABEL = "#5b6561";

interface Ctx {
  m: EmailModel;
  tight?: boolean;
}

function textStyle(m: EmailModel, extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    margin: "0 0 14px",
    fontFamily: m.branding.fontStack,
    fontSize: "15px",
    lineHeight: "24px",
    color: m.branding.textColor,
    ...extra,
  };
}

function renderMarks(text: React.ReactNode, marks: Mark[] | undefined, ctx: Ctx, key: number): React.ReactNode {
  let node = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        node = <strong>{node}</strong>;
        break;
      case "italic":
        node = <em>{node}</em>;
        break;
      case "underline":
        node = <u>{node}</u>;
        break;
      case "strike":
        node = <s>{node}</s>;
        break;
      case "textStyle":
        if (mark.attrs?.color) node = <span style={{ color: mark.attrs.color }}>{node}</span>;
        break;
      case "link":
        break;
    }
  }
  const link = marks?.find((mk) => mk.type === "link");
  if (link && link.type === "link") {
    node = (
      <Link href={link.attrs.href} style={{ color: ctx.m.branding.primaryColor, textDecoration: "underline" }}>
        {node}
      </Link>
    );
  }
  return <React.Fragment key={key}>{node}</React.Fragment>;
}

function Inline({ nodes, ctx }: { nodes?: InlineNode[]; ctx: Ctx }) {
  if (!nodes?.length) return <>&nbsp;</>;
  return (
    <>
      {nodes.map((n, i) => (n.type === "hardBreak" ? <br key={i} /> : renderMarks(n.text, n.marks, ctx, i)))}
    </>
  );
}

function Table({ children, style, align }: { children: React.ReactNode; style?: React.CSSProperties; align?: "center" }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      align={align}
      style={{ borderCollapse: "collapse", ...style }}
    >
      <tbody>{children}</tbody>
    </table>
  );
}

function OutlookCard({ chart, ahead, ctx }: { chart: RevenueChart; ahead: ChartAhead | null; ctx: Ctx }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ borderCollapse: "separate", margin: "6px 0 24px", backgroundColor: "#ffffff", border: `1px solid ${METRIC_BORDER}`, borderRadius: "12px" }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "16px 20px 0" }}>
            <p style={textStyle(ctx.m, { margin: "0", fontSize: "12px", lineHeight: "16px", fontWeight: 600, color: METRIC_LABEL })}>{REVENUE_YTD_LABEL}</p>
          </td>
        </tr>
        <tr>
          <td style={{ padding: "4px 12px 0" }}>
            <Img
              src={ctx.m.chartUrl(chart, ahead)}
              alt={chartAltText(chart, ahead)}
              width={CHART_SIZE.width}
              height={CHART_SIZE.height}
              style={{ display: "block", width: "100%", maxWidth: `${CHART_SIZE.width * 1.3}px`, height: "auto", border: 0, margin: "0 auto" }}
            />
          </td>
        </tr>
        {ahead ? (
          <tr>
            <td style={{ padding: "6px 20px 14px" }}>
              <p style={textStyle(ctx.m, { margin: "0", fontSize: "12px", lineHeight: "16px", color: MUTED })}>{CHART_FOOTNOTE}</p>
            </td>
          </tr>
        ) : (
          <tr>
            <td style={{ padding: "0 0 12px" }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Metrics({ items, ctx }: { items: MetricItem[]; ctx: Ctx }) {
  // One ledger card. The hero figure (Revenue YTD, or the first card) leads with its chart
  // beside it; the other figures follow as label-and-value rows. Rows keep working at any
  // width, so the strip reads the same in Gmail, a phone's mail app and the PDF. Tabular
  // figures keep digits aligned when investors compare one quarter with the last.
  const heroIndex = Math.max(0, items.findIndex((it) => it.label === REVENUE_YTD_LABEL));
  const hero = items[heroIndex];
  if (!hero) return null;
  const chart = hero.label === REVENUE_YTD_LABEL && hasChartData(hero.chart) ? hero.chart : null;
  // The other cards extend the line past the as-of month: dashed for contracted, dotted for proposed.
  const ahead = chart ? chartAheadFrom(items) : null;
  // With monthly figures, the chart carries every figure: received, then signed and proposed
  // fanning out with no dates. The rows below are the fallback when there's no chart.
  if (chart) return <OutlookCard chart={chart} ahead={ahead} ctx={ctx} />;
  const rows = items.filter((_, i) => i !== heroIndex);
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{
        borderCollapse: "separate",
        margin: "6px 0 24px",
        backgroundColor: "#ffffff",
        border: `1px solid ${METRIC_BORDER}`,
        borderRadius: "12px",
      }}
    >
      <tbody>
        <tr>
          <td colSpan={2} style={{ padding: "18px 20px 16px" }}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td valign="bottom" style={{ textAlign: "left" }}>
                    <p style={textStyle(ctx.m, { margin: "0", fontSize: "12px", lineHeight: "16px", fontWeight: 600, color: METRIC_LABEL })}>
                      {hero.label}
                    </p>
                    <p
                      style={textStyle(ctx.m, {
                        margin: "2px 0 0",
                        fontSize: "30px",
                        lineHeight: "34px",
                        fontWeight: 700,
                        letterSpacing: "-0.5px",
                        fontVariantNumeric: "tabular-nums",
                        color: ctx.m.branding.primaryColor,
                      })}
                    >
                      {metricDisplayValue(hero)}
                    </p>
                    {hero.sublabel ? (
                      <p style={textStyle(ctx.m, { margin: "2px 0 0", fontSize: "12px", lineHeight: "16px", color: MUTED })}>{hero.sublabel}</p>
                    ) : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        {rows.map((it, i) => (
          <tr key={i}>
            <td valign="middle" style={{ padding: "12px 0 12px 20px", borderTop: `1px solid ${METRIC_RULE}`, textAlign: "left" }}>
              <p style={textStyle(ctx.m, { margin: "0", fontSize: "13px", lineHeight: "18px", fontWeight: 600 })}>
                {it.label}
              </p>
              {it.sublabel ? (
                <p style={textStyle(ctx.m, { margin: "1px 0 0", fontSize: "12px", lineHeight: "16px", color: MUTED })}>{it.sublabel}</p>
              ) : null}
            </td>
            <td valign="middle" align="right" style={{ padding: "12px 20px 12px 12px", borderTop: `1px solid ${METRIC_RULE}`, textAlign: "right", whiteSpace: "nowrap" }}>
              <p
                style={textStyle(ctx.m, {
                  margin: "0",
                  fontSize: "20px",
                  lineHeight: "26px",
                  fontWeight: 700,
                  letterSpacing: "-0.2px",
                  fontVariantNumeric: "tabular-nums",
                })}
              >
                {metricDisplayValue(it)}
              </p>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Block({ node, ctx }: { node: BlockNode; ctx: Ctx }): React.ReactElement | null {
  const { m } = ctx;
  switch (node.type) {
    case "paragraph": {
      const align = node.attrs?.textAlign ?? undefined;
      return (
        <p style={textStyle(m, { textAlign: align ?? "left", ...(ctx.tight ? { margin: "0 0 4px" } : {}) })}>
          <Inline nodes={node.content} ctx={ctx} />
        </p>
      );
    }
    case "heading": {
      const sizes = { 1: ["24px", "32px"], 2: ["18px", "26px"], 3: ["16px", "24px"] } as const;
      const [fontSize, lineHeight] = sizes[node.attrs.level];
      const Tag = `h${node.attrs.level}` as "h1" | "h2" | "h3";
      return (
        <Tag
          style={textStyle(m, {
            margin: node.attrs.level === 1 ? "8px 0 14px" : "22px 0 10px",
            fontSize,
            lineHeight,
            fontWeight: 700,
            textAlign: node.attrs.textAlign ?? "left",
            color: node.attrs.level === 1 ? m.branding.primaryColor : m.branding.textColor,
          })}
        >
          <Inline nodes={node.content} ctx={ctx} />
        </Tag>
      );
    }
    case "pullQuote":
      return (
        <p
          style={textStyle(m, {
            fontStyle: "italic",
            fontSize: "18px",
            lineHeight: "28px",
            textAlign: "center",
            color: QUOTE_GREY,
            margin: "0 0 18px",
            padding: "0 12px",
          })}
        >
          <Inline nodes={node.content} ctx={ctx} />
        </p>
      );
    case "bulletList":
      if (m.branding.bulletUrl) {
        const bulletUrl = m.branding.bulletUrl;
        return (
          <Table style={{ margin: "0 0 16px" }}>
            {node.content.map((li, i) => (
              <tr key={i}>
                <td width={22} valign="top" style={{ width: "22px", paddingTop: "7px" }}>
                  <Img src={bulletUrl} alt="" width={11} height={11} style={{ display: "block", border: 0 }} />
                </td>
                <td valign="top" style={{ paddingBottom: "8px" }}>
                  {li.content.map((c, j) => (
                    <Block key={j} node={c} ctx={{ ...ctx, tight: true }} />
                  ))}
                </td>
              </tr>
            ))}
          </Table>
        );
      }
    // falls through to a standard list
    case "orderedList": {
      const ListTag = node.type === "bulletList" ? "ul" : "ol";
      const start = node.type === "orderedList" ? (node.attrs?.start ?? 1) : undefined;
      return (
        <ListTag start={start} style={{ margin: "0 0 16px", padding: "0 0 0 24px" }}>
          {node.content.map((li, i) => (
            <li key={i} style={textStyle(m, { margin: "0 0 8px" })}>
              {li.content.map((c, j) => (
                <Block key={j} node={c} ctx={{ ...ctx, tight: true }} />
              ))}
            </li>
          ))}
        </ListTag>
      );
    }
    case "blockquote":
      return (
        <Table style={{ margin: "0 0 16px" }}>
          <tr>
            <td style={{ borderLeft: `3px solid ${BORDER}`, padding: "2px 0 2px 14px" }}>
              {node.content.map((c, i) => (
                <Block key={i} node={c} ctx={ctx} />
              ))}
            </td>
          </tr>
        </Table>
      );
    case "callout": {
      const tones = {
        note: "#f3f4f6",
        info: "#eff6ff",
        success: "#ecfdf5",
        warning: "#fffbeb",
      } as const;
      return (
        <Table style={{ margin: "4px 0 18px" }}>
          <tr>
            <td
              style={{
                backgroundColor: tones[node.attrs.tone],
                borderLeft: `3px solid ${m.branding.primaryColor}`,
                padding: "14px 16px 2px",
              }}
            >
              {node.content.map((c, i) => (
                <Block key={i} node={c} ctx={ctx} />
              ))}
            </td>
          </tr>
        </Table>
      );
    }
    case "metrics":
      return <Metrics items={node.attrs.items} ctx={ctx} />;
    case "image": {
      const width = node.attrs.width ?? 552;
      return (
        <Table style={{ margin: "0 0 18px" }}>
          <tr>
            <td align={node.attrs.align}>
              <Img
                src={m.resolveImage(node.attrs.assetId)}
                alt={node.attrs.alt}
                width={width}
                style={{ display: "block", maxWidth: "100%", height: "auto", border: 0 }}
              />
            </td>
          </tr>
        </Table>
      );
    }
    case "horizontalRule": {
      const short = node.attrs?.variant === "short";
      return (
        <Table style={{ margin: "6px 0 20px" }}>
          <tr>
            <td align="center">
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width={short ? 220 : "100%"}>
                <tbody>
                  <tr>
                    <td style={{ borderTop: `1px solid ${short ? m.branding.textColor : BORDER}`, fontSize: 0, lineHeight: 0 }}>
                      &nbsp;
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </Table>
      );
    }
    case "table":
      return (
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ borderCollapse: "collapse", margin: "0 0 18px", border: `1px solid ${BORDER}` }}
        >
          <tbody>
            {node.content.map((row, r) => (
              <tr key={r}>
                {row.content.map((cell, c) => (
                  <td
                    key={c}
                    colSpan={cell.attrs?.colspan ?? 1}
                    rowSpan={cell.attrs?.rowspan ?? 1}
                    valign="top"
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: "8px 10px 0",
                      backgroundColor: cell.type === "tableHeader" ? "#f9fafb" : "#ffffff",
                      fontWeight: cell.type === "tableHeader" ? 700 : 400,
                    }}
                  >
                    {cell.content.map((b, i) => (
                      <Block key={i} node={b} ctx={{ ...ctx, tight: false }} />
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export function InvestorUpdateEmail({ model }: { model: EmailModel }) {
  const m = model;
  const ctx: Ctx = { m };
  const small = textStyle(m, { fontSize: "12px", lineHeight: "18px", color: MUTED, margin: "0 0 6px", textAlign: "center" });
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
        {m.branding.fontStack.includes("Nunito Sans") ? (
          // An email, not a Next.js page: clients that honour web fonts load Nunito Sans, the rest fall back.
          // eslint-disable-next-line @next/next/no-page-custom-font
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,400;0,700;0,900;1,400&display=swap"
          />
        ) : null}
      </Head>
      {m.previewText ? <Preview>{m.previewText}</Preview> : null}
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: m.branding.fontStack }}>
        {m.isTest ? (
          <Table>
            <tr>
              <td
                align="center"
                style={{
                  backgroundColor: "#fef3c7",
                  color: "#92400e",
                  fontFamily: m.branding.fontStack,
                  fontSize: "13px",
                  lineHeight: "20px",
                  padding: "10px 16px",
                  fontWeight: 700,
                }}
              >
                TEST EMAIL — this preview was not sent to investors.
              </td>
            </tr>
          </Table>
        ) : null}
        <Container style={{ maxWidth: "600px", width: "100%", margin: "0 auto", padding: "32px 24px 24px" }}>
          <Table style={{ margin: "0 0 20px" }}>
            <tr>
              <td align="center">
                {m.branding.logoUrl ? (
                  <Img
                    src={m.branding.logoUrl}
                    alt={m.branding.companyName}
                    width={320}
                    style={{ display: "block", maxWidth: "320px", height: "auto", border: 0, margin: "0 auto" }}
                  />
                ) : (
                  <p
                    style={textStyle(m, {
                      margin: 0,
                      fontSize: "26px",
                      lineHeight: "32px",
                      fontWeight: 700,
                      letterSpacing: "1px",
                      color: m.branding.primaryColor,
                      textAlign: "center",
                    })}
                  >
                    {m.branding.companyName.toUpperCase()}
                  </p>
                )}
              </td>
            </tr>
          </Table>

          {m.bannerUrl ? (
            <Table style={{ margin: "0 0 20px" }}>
              <tr>
                <td align="center">
                  <Img src={m.bannerUrl} alt="" width={552} style={{ display: "block", maxWidth: "100%", height: "auto", border: 0 }} />
                </td>
              </tr>
            </Table>
          ) : null}

          {m.doc.content.map((node, i) => (
            <Block key={i} node={node} ctx={ctx} />
          ))}

          {m.pdf.mode !== "none" || m.attachments.length ? (
            <Table style={{ margin: "12px 0 8px" }}>
              <tr>
                <td style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "16px" }}>
                  {m.pdf.mode === "attach" ? (
                    <p style={textStyle(m, { fontSize: "13px", lineHeight: "20px", color: MUTED })}>
                      A PDF copy of this update ({m.pdf.filename}) is attached.
                    </p>
                  ) : null}
                  {m.pdf.mode === "link" && m.pdf.url ? (
                    <p style={textStyle(m, { fontSize: "13px", lineHeight: "20px" })}>
                      <Link href={m.pdf.url} style={{ color: m.branding.primaryColor, textDecoration: "underline" }}>
                        Download this update as a PDF
                      </Link>
                      <span style={{ color: MUTED }}> (secure link, expires)</span>
                    </p>
                  ) : null}
                  {m.attachments.map((a, i) => (
                    <p key={i} style={textStyle(m, { fontSize: "13px", lineHeight: "20px", margin: "0 0 6px" })}>
                      <Link href={a.url} style={{ color: m.branding.primaryColor, textDecoration: "underline" }}>
                        {a.name}
                      </Link>
                    </p>
                  ))}
                </td>
              </tr>
            </Table>
          ) : null}

          <Table style={{ margin: "28px 0 0" }}>
            <tr>
              <td style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "18px" }}>
                <p style={small}>
                  {m.branding.companyName}
                  {m.footer.postalAddress ? `, ${m.footer.postalAddress}` : ""}
                </p>
                {m.footer.note ? <p style={small}>{m.footer.note}</p> : null}
                <p style={small}>
                  {m.footer.replyTo ? (
                    <>
                      Questions? Reply to this email or write to{" "}
                      <Link href={`mailto:${m.footer.replyTo}`} style={{ color: MUTED, textDecoration: "underline" }}>
                        {m.footer.replyTo}
                      </Link>
                      .{" "}
                    </>
                  ) : null}
                  <Link href={m.footer.unsubscribeUrl} style={{ color: MUTED, textDecoration: "underline" }}>
                    Unsubscribe
                  </Link>
                </p>
              </td>
            </tr>
          </Table>
        </Container>
      </Body>
    </Html>
  );
}
