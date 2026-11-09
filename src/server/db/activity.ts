import "server-only";
import type { AuditLog } from "@/lib/types";
import { db } from "../firebase-admin";
import { data, isoRequired, str } from "./convert";

const VISIBLE_ACTIONS = new Set([
  "investor.create",
  "investor.import",
  "investor.bulk",
  "investor.export",
  "group.create",
  "group.delete",
  "suppression.add",
  "suppression.remove",
  "update.create",
  "update.save",
  "update.duplicate",
  "update.delete",
  "update.restore",
  "update.test_send",
  "campaign.prepare",
  "campaign.cancel",
  "campaign.approve",
  "campaign.completed",
  "campaign.failure",
  "settings.update",
  "unsubscribe",
]);

/** Recent meaningful activity for the dashboard (sign-ins and uploads are omitted as noise). */
export async function recentActivity(limit = 12): Promise<AuditLog[]> {
  const snap = await db().collection("auditLogs").orderBy("at", "desc").limit(limit * 3).get();
  return snap.docs
    .map((d) => {
      const x = data(d);
      return {
        id: d.id,
        actorEmail: str(x.actorEmail),
        action: str(x.action),
        resourceType: str(x.resourceType),
        resourceId: typeof x.resourceId === "string" ? x.resourceId : null,
        summary: str(x.summary),
        at: isoRequired(x.at),
      };
    })
    .filter((a) => VISIBLE_ACTIONS.has(a.action))
    .slice(0, limit);
}
