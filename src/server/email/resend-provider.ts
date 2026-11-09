import "server-only";
import { Resend } from "resend";
import type { DomainStatus, EmailProvider, OutgoingEmail, SendResult } from "./provider";

const RETRYABLE = new Set([
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
  "application_error",
  "internal_server_error",
  "daily_quota_exceeded",
]);

export class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;
  readonly live = true;
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    try {
      const { data, error } = await this.client.emails.send(
        {
          from: email.from,
          to: email.to,
          replyTo: email.replyTo || undefined,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: email.headers,
          tags: Object.entries(email.tags).map(([name, value]) => ({ name, value })),
          attachments: email.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        },
        { idempotencyKey: email.idempotencyKey },
      );
      if (data?.id) return { ok: true, messageId: data.id };
      const code = error?.name ?? "unknown_error";
      const status = error?.statusCode ?? null;
      const retryable = RETRYABLE.has(code) || status === null || status === 429 || (status ?? 0) >= 500;
      return {
        ok: false,
        retryable,
        code,
        message: error?.message ?? "Unknown provider error",
        // Same idempotency key with a different payload: never resend automatically.
        needsReview: code === "invalid_idempotent_request",
      };
    } catch (err) {
      return { ok: false, retryable: true, code: "network_error", message: (err as Error).message ?? "Network error" };
    }
  }

  async domainStatus(domain: string): Promise<DomainStatus> {
    const base: DomainStatus = {
      provider: "resend",
      domain,
      found: false,
      status: "not_found",
      verified: false,
      records: [],
      openTracking: null,
      clickTracking: null,
    };
    try {
      const list = await this.client.domains.list();
      if (list.error) return { ...base, status: "error", error: list.error.message };
      const match = list.data?.data.find((d) => d.name.toLowerCase() === domain.toLowerCase());
      if (!match) return base;
      const detail = await this.client.domains.get(match.id);
      if (detail.error || !detail.data) return { ...base, found: true, status: match.status, error: detail.error?.message };
      return {
        provider: "resend",
        domain,
        found: true,
        status: detail.data.status,
        verified: detail.data.status === "verified",
        records: detail.data.records.map((r) => ({
          record: r.record,
          type: r.type,
          name: r.name,
          value: r.value,
          status: r.status,
        })),
        openTracking: detail.data.open_tracking ?? null,
        clickTracking: detail.data.click_tracking ?? null,
      };
    } catch (err) {
      return { ...base, status: "error", error: (err as Error).message };
    }
  }
}
