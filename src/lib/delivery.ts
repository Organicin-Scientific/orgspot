import type { CampaignStats, RecipientStatus } from "./types";

export const PROVIDER_EVENT_TYPES = [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "failed",
  "suppressed",
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];

export interface RecipientDeliveryState {
  status: RecipientStatus;
  acceptedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  failedAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
}

export interface NormalizedProviderEvent {
  type: ProviderEventType;
  occurredAt: string;
  /** For bounces: "Permanent" | "Transient" | "Undetermined" as reported by the provider. */
  bounceType?: string;
}

export type StatsDelta = Partial<Record<keyof CampaignStats, number>>;

export interface DeliveryTransition {
  patch: Partial<RecipientDeliveryState>;
  stats: StatsDelta;
  /** Suppress the address globally (hard bounce, complaint or provider suppression). */
  suppress: "bounce" | "complaint" | null;
  changed: boolean;
}

/**
 * Status precedence. Webhooks can arrive late, twice, or out of order, so a status only
 * ever moves "up" this ladder: a late `delivered` can never overwrite a `bounced`.
 */
const RANK: Record<RecipientStatus, number> = {
  queued: 0,
  sending: 0,
  retry_wait: 0,
  needs_review: 0,
  skipped: 0,
  accepted: 1,
  delivered: 2,
  failed: 3,
  bounced: 4,
  complained: 5,
};

const TIMESTAMP_FIELD: Partial<Record<ProviderEventType, keyof RecipientDeliveryState>> = {
  sent: "acceptedAt",
  delivered: "deliveredAt",
  bounced: "bouncedAt",
  suppressed: "bouncedAt",
  complained: "complainedAt",
  failed: "failedAt",
  opened: "openedAt",
  clicked: "clickedAt",
};

const STAT_FIELD: Partial<Record<keyof RecipientDeliveryState, keyof CampaignStats>> = {
  acceptedAt: "accepted",
  deliveredAt: "delivered",
  bouncedAt: "bounced",
  complainedAt: "complained",
  failedAt: "failed",
  openedAt: "opened",
  clickedAt: "clicked",
};

const STATUS_FOR_EVENT: Partial<Record<ProviderEventType, RecipientStatus>> = {
  sent: "accepted",
  delivered: "delivered",
  bounced: "bounced",
  suppressed: "bounced",
  complained: "complained",
  failed: "failed",
};

/**
 * Pure transition function applied inside a Firestore transaction for every webhook.
 * Stats count *unique recipients* per event type, so each timestamp is set at most once.
 */
export function applyProviderEvent(
  state: RecipientDeliveryState,
  event: NormalizedProviderEvent,
): DeliveryTransition {
  const patch: Partial<RecipientDeliveryState> = {};
  const stats: StatsDelta = {};
  let suppress: DeliveryTransition["suppress"] = null;

  const field = TIMESTAMP_FIELD[event.type];
  if (field && !state[field]) {
    (patch as Record<string, string>)[field] = event.occurredAt;
    const stat = STAT_FIELD[field];
    if (stat) stats[stat] = (stats[stat] ?? 0) + 1;
  }

  // A delivery-side event proves the provider accepted the message even if the `sent`
  // webhook was lost or the worker crashed before recording acceptance.
  const impliesAccepted = ["delivered", "bounced", "complained", "opened", "clicked", "delivery_delayed"].includes(
    event.type,
  );
  if (impliesAccepted && !state.acceptedAt && !patch.acceptedAt) {
    patch.acceptedAt = event.occurredAt;
    stats.accepted = (stats.accepted ?? 0) + 1;
  }

  const target = STATUS_FOR_EVENT[event.type];
  if (target && RANK[target] > RANK[state.status]) {
    patch.status = target;
  } else if (impliesAccepted && RANK[state.status] < RANK.accepted) {
    patch.status = "accepted";
  }

  if (event.type === "complained") suppress = "complaint";
  if (event.type === "bounced" && (event.bounceType ?? "").toLowerCase() === "permanent") suppress = "bounce";
  if (event.type === "suppressed") suppress = "bounce";

  return { patch, stats, suppress, changed: Object.keys(patch).length > 0 };
}

const TERMINAL: RecipientStatus[] = ["accepted", "delivered", "bounced", "complained", "failed", "skipped", "needs_review"];
export function isTerminalSendState(status: RecipientStatus): boolean {
  return TERMINAL.includes(status);
}

export function emptyStats(): CampaignStats {
  return {
    selected: 0,
    eligible: 0,
    excluded: 0,
    accepted: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    skipped: 0,
    unsubscribed: 0,
    opened: 0,
    clicked: 0,
  };
}

/** Exponential backoff with full jitter, capped. `attempt` is 1-based. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 30_000 * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, 30 * 60_000);
  return Math.round(capped / 2 + random() * (capped / 2));
}

export const MAX_SEND_ATTEMPTS = 5;
/** Resend keeps idempotency keys for 24h; beyond that a retry could duplicate a send. */
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60_000;
