import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { log } from "./logger";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "investor.create"
  | "investor.update"
  | "investor.delete"
  | "investor.bulk"
  | "investor.export"
  | "investor.import"
  | "group.create"
  | "group.update"
  | "group.delete"
  | "suppression.add"
  | "suppression.remove"
  | "update.create"
  | "update.save"
  | "update.duplicate"
  | "update.delete"
  | "update.restore"
  | "update.test_send"
  | "update.ai_draft"
  | "campaign.prepare"
  | "campaign.cancel"
  | "campaign.approve"
  | "campaign.completed"
  | "campaign.failure"
  | "settings.update"
  | "asset.upload"
  | "block.create"
  | "block.delete"
  | "unsubscribe";

export interface AuditEntry {
  actorEmail: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  /** Human-readable, non-sensitive summary (counts and titles only, never addresses or content). */
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db()
      .collection("auditLogs")
      .add({ ...entry, resourceId: entry.resourceId ?? null, at: FieldValue.serverTimestamp() });
  } catch (err) {
    log.error("audit.write_failed", { action: entry.action, err });
  }
}
