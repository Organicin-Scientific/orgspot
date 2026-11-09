import "server-only";

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** ASCII letters, digits, `_` and `-` only. Used to correlate webhooks. */
  tags: Record<string, string>;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** Same key + same payload ⇒ the provider returns the original message instead of sending again. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; code: string; message: string; needsReview?: boolean };

export interface DomainRecordStatus {
  record: string;
  type: string;
  name: string;
  value: string;
  status: string;
}

export interface DomainStatus {
  provider: string;
  domain: string;
  found: boolean;
  status: string;
  verified: boolean;
  records: DomainRecordStatus[];
  openTracking: boolean | null;
  clickTracking: boolean | null;
  error?: string;
}

/** Abstraction so the delivery provider can be replaced without touching campaign logic. */
export interface EmailProvider {
  readonly name: "resend" | "sandbox";
  readonly live: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
  domainStatus(domain: string): Promise<DomainStatus>;
}
