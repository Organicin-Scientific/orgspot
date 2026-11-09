/**
 * Organicin brand assets and type (OS-02 Brand Guide): green #157A6E, gold #F2B772 accent,
 * Nunito Sans. Shared by the editor, the email and the PDF so all three look the same.
 */
export const DEFAULT_LOGO_PATH = "/brand/organicin-logo.png";

/** Leaf bullet for unordered lists, drawn after the leaf in the wordmark's G. */
export const LEAF_BULLET_PNG_PATH = "/brand/leaf-bullet.png";
export const LEAF_BULLET_SVG_PATH = "/brand/leaf-bullet.svg";

export const BRAND_GREEN = "#157A6E";
export const BRAND_GOLD = "#F2B772";

export const FONT_STACKS = {
  nunito: "'Nunito Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  verdana: "Verdana, Geneva, sans-serif",
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
} as const;
export type FontKey = keyof typeof FONT_STACKS;

export function fontStack(key: string): string {
  return FONT_STACKS[key as FontKey] ?? FONT_STACKS.nunito;
}

/** The editor loads Nunito Sans itself (next/font in the root layout), exposed as a CSS variable. */
export function editorFontStack(key: string): string {
  return key === "nunito" ? `var(--font-nunito-sans), ${FONT_STACKS.nunito}` : fontStack(key);
}
