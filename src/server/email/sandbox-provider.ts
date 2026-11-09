import "server-only";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase-admin";
import type { DomainStatus, EmailProvider, OutgoingEmail, SendResult } from "./provider";

/**
 * Development/preview provider. Nothing leaves the system: messages are recorded in the
 * `sandboxOutbox` collection (metadata only) and delivery events are simulated.
 *
 * Synthetic addresses can trigger specific outcomes for testing:
 *  - `*@bounce.test`     → permanent bounce
 *  - `*@complaint.test`  → spam complaint
 *  - `*@fail.test`       → permanent provider rejection
 *  - `*@flaky.test`      → transient error on the first attempt
 */
export class SandboxProvider implements EmailProvider {
  readonly name = "sandbox" as const;
  readonly live = false;

  async send(email: OutgoingEmail): Promise<SendResult> {
    const to = email.to.toLowerCase();
    if (to.endsWith("@fail.test")) {
      return { ok: false, retryable: false, code: "validation_error", message: "Simulated permanent rejection" };
    }
    const messageId = `sbx_${createHash("sha256").update(email.idempotencyKey).digest("hex").slice(0, 24)}`;
    const ref = db().collection("sandboxOutbox").doc(messageId);
    if (to.endsWith("@flaky.test")) {
      const prior = await ref.get();
      if (!prior.exists) {
        await ref.set({ flakyAttempted: true }, { merge: true });
        return { ok: false, retryable: true, code: "rate_limit_exceeded", message: "Simulated transient error" };
      }
    }
    await ref.set(
      {
        messageId,
        idempotencyKey: email.idempotencyKey,
        toDomain: to.split("@")[1] ?? "",
        subject: email.subject,
        htmlBytes: Buffer.byteLength(email.html),
        textBytes: Buffer.byteLength(email.text),
        attachments: (email.attachments ?? []).map((a) => ({ filename: a.filename, bytes: a.content.length })),
        headers: Object.keys(email.headers),
        tags: email.tags,
        sends: FieldValue.increment(1),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, messageId };
  }

  async domainStatus(domain: string): Promise<DomainStatus> {
    return {
      provider: "sandbox",
      domain,
      found: true,
      status: "sandbox",
      verified: true,
      records: [],
      openTracking: null,
      clickTracking: null,
    };
  }
}

/** Which simulated events a sandbox message should produce. */
export function sandboxOutcome(email: string): ("sent" | "delivered" | "bounced" | "complained")[] {
  const to = email.toLowerCase();
  if (to.endsWith("@bounce.test")) return ["sent", "bounced"];
  if (to.endsWith("@complaint.test")) return ["sent", "delivered", "complained"];
  return ["sent", "delivered"];
}
