import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { AppSettings } from "@/lib/types";
import { env } from "../env";
import { db } from "../firebase-admin";
import { iso, str } from "./convert";

export const DEFAULT_BRAND_COLOR = "#1f6f5c";

export const FONT_STACKS = {
  helvetica: "Helvetica, Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  verdana: "Verdana, Geneva, sans-serif",
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
} as const;
export type FontKey = keyof typeof FONT_STACKS;

export function defaultSettings(): AppSettings {
  const sender = process.env.SENDER_EMAIL ?? "";
  return {
    branding: {
      companyName: "Organicin Scientific",
      logoAssetId: null,
      primaryColor: DEFAULT_BRAND_COLOR,
      textColor: "#1f2937",
      fontFamily: "helvetica",
    },
    sender: { fromName: "Organicin Scientific", fromEmail: sender, replyTo: "" },
    postalAddress: "",
    footerNote: "You are receiving this email because you are an investor in, or advisor to, Organicin Scientific.",
    updatedAt: null,
    updatedBy: null,
  };
}

const ref = () => db().collection("settings").doc("app");

export async function getSettings(): Promise<AppSettings> {
  const snap = await ref().get();
  const def = defaultSettings();
  if (!snap.exists) return def;
  const d = snap.data() ?? {};
  const b = (d.branding ?? {}) as Partial<AppSettings["branding"]>;
  const s = (d.sender ?? {}) as Partial<AppSettings["sender"]>;
  return {
    branding: {
      companyName: str(b.companyName, def.branding.companyName),
      logoAssetId: typeof b.logoAssetId === "string" ? b.logoAssetId : null,
      primaryColor: str(b.primaryColor, def.branding.primaryColor),
      textColor: str(b.textColor, def.branding.textColor),
      fontFamily: str(b.fontFamily, def.branding.fontFamily),
    },
    sender: {
      fromName: str(s.fromName, def.sender.fromName),
      fromEmail: str(s.fromEmail, def.sender.fromEmail),
      replyTo: str(s.replyTo),
    },
    postalAddress: str(d.postalAddress),
    footerNote: str(d.footerNote, def.footerNote),
    updatedAt: iso(d.updatedAt),
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
  };
}

export async function saveSettings(next: Omit<AppSettings, "updatedAt" | "updatedBy">, actor: string) {
  await ref().set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor });
  return getSettings();
}

export function fontStack(key: string): string {
  return FONT_STACKS[key as FontKey] ?? FONT_STACKS.helvetica;
}

export interface SendReadiness {
  ready: boolean;
  problems: string[];
}

/** Configuration checks shown in Settings and enforced before test sends and campaigns. */
export function sendReadiness(s: AppSettings): SendReadiness {
  const problems: string[] = [];
  if (!s.sender.fromEmail) problems.push("Set a sender email address in Settings.");
  if (!s.sender.fromName) problems.push("Set a sender name in Settings.");
  if (!s.postalAddress.trim()) problems.push("Add the company postal address (required in the email footer).");
  if (env().SENDER_EMAIL && s.sender.fromEmail && s.sender.fromEmail.toLowerCase().split("@")[1] !== env().SENDER_EMAIL!.toLowerCase().split("@")[1]) {
    problems.push("Sender email must use the verified sending domain configured for this environment.");
  }
  return { ready: problems.length === 0, problems };
}
