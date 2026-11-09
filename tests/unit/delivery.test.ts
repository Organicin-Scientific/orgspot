import { describe, expect, it } from "vitest";
import {
  applyProviderEvent,
  backoffMs,
  emptyStats,
  isTerminalSendState,
  type RecipientDeliveryState,
} from "../../src/lib/delivery";

function baseState(overrides: Partial<RecipientDeliveryState> = {}): RecipientDeliveryState {
  return {
    status: "queued",
    acceptedAt: null,
    deliveredAt: null,
    bouncedAt: null,
    complainedAt: null,
    failedAt: null,
    openedAt: null,
    clickedAt: null,
    ...overrides,
  };
}

describe("applyProviderEvent", () => {
  it("first delivered on accepted sets deliveredAt, status delivered, stats delivered +1", () => {
    const state = baseState({
      status: "accepted",
      acceptedAt: "2025-01-01T00:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "delivered", occurredAt: "2025-01-02T00:00:00Z" });
    expect(r.patch).toMatchObject({
      deliveredAt: "2025-01-02T00:00:00Z",
      status: "delivered",
    });
    expect(r.stats).toEqual({ delivered: 1 });
    expect(r.changed).toBe(true);
  });

  it("duplicate delivered (deliveredAt already set) produces no stats delta and changed=false", () => {
    const state = baseState({
      status: "delivered",
      acceptedAt: "2025-01-01T00:00:00Z",
      deliveredAt: "2025-01-02T00:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "delivered", occurredAt: "2025-01-03T00:00:00Z" });
    expect(r.stats).toEqual({});
    expect(r.patch).toEqual({});
    expect(r.changed).toBe(false);
  });

  it("out-of-order: delivered after bounced does not downgrade status but sets deliveredAt if absent", () => {
    const state = baseState({
      status: "bounced",
      acceptedAt: "2025-01-01T00:00:00Z",
      bouncedAt: "2025-01-03T00:00:00Z",
      deliveredAt: null,
    });
    const r = applyProviderEvent(state, { type: "delivered", occurredAt: "2025-01-02T00:00:00Z" });
    expect(r.patch).toEqual({ deliveredAt: "2025-01-02T00:00:00Z" });
    expect(r.patch.status).toBeUndefined();
    expect(r.stats).toEqual({ delivered: 1 });
    expect(r.changed).toBe(true);
  });

  it("bounced after delivered upgrades status to bounced", () => {
    const state = baseState({
      status: "delivered",
      acceptedAt: "2025-01-01T00:00:00Z",
      deliveredAt: "2025-01-02T00:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "bounced", occurredAt: "2025-01-04T00:00:00Z", bounceType: "Transient" });
    expect(r.patch).toMatchObject({
      bouncedAt: "2025-01-04T00:00:00Z",
      status: "bounced",
    });
    expect(r.stats).toEqual({ bounced: 1 });
  });

  it("complained sets suppress complaint and status complained", () => {
    const state = baseState({
      status: "delivered",
      acceptedAt: "2025-01-01T00:00:00Z",
      deliveredAt: "2025-01-02T00:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "complained", occurredAt: "2025-01-05T00:00:00Z" });
    expect(r.suppress).toBe("complaint");
    expect(r.patch).toMatchObject({
      complainedAt: "2025-01-05T00:00:00Z",
      status: "complained",
    });
    expect(r.stats).toEqual({ complained: 1 });
  });

  it("bounced Permanent sets suppress bounce; Transient leaves suppress null", () => {
    const accepted = baseState({
      status: "accepted",
      acceptedAt: "2025-01-01T00:00:00Z",
    });
    const permanent = applyProviderEvent(accepted, {
      type: "bounced",
      occurredAt: "2025-01-03T00:00:00Z",
      bounceType: "Permanent",
    });
    expect(permanent.suppress).toBe("bounce");

    const delivered = baseState({
      status: "delivered",
      acceptedAt: "2025-01-01T00:00:00Z",
      deliveredAt: "2025-01-02T00:00:00Z",
    });
    const transient = applyProviderEvent(delivered, {
      type: "bounced",
      occurredAt: "2025-01-04T00:00:00Z",
      bounceType: "Transient",
    });
    expect(transient.suppress).toBeNull();
  });

  it("opened on sending sets acceptedAt, stats accepted and opened, status accepted, and openedAt", () => {
    const state = baseState({ status: "sending" });
    const r = applyProviderEvent(state, { type: "opened", occurredAt: "2025-01-01T12:00:00Z" });
    expect(r.patch).toMatchObject({
      acceptedAt: "2025-01-01T12:00:00Z",
      openedAt: "2025-01-01T12:00:00Z",
      status: "accepted",
    });
    expect(r.stats).toEqual({ accepted: 1, opened: 1 });
  });

  it("repeated opened events count once for stats", () => {
    const state = baseState({
      status: "accepted",
      acceptedAt: "2025-01-01T00:00:00Z",
      openedAt: "2025-01-01T12:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "opened", occurredAt: "2025-01-02T00:00:00Z" });
    expect(r.stats).toEqual({});
    expect(r.patch).toEqual({});
    expect(r.changed).toBe(false);
  });

  it("sent when acceptedAt already set does not increment accepted", () => {
    const state = baseState({
      status: "accepted",
      acceptedAt: "2025-01-01T00:00:00Z",
    });
    const r = applyProviderEvent(state, { type: "sent", occurredAt: "2025-01-02T00:00:00Z" });
    expect(r.stats).toEqual({});
    expect(r.patch).toEqual({});
    expect(r.changed).toBe(false);
  });
});

describe("backoffMs", () => {
  it("with random=0: attempt 1 => 15000, attempt 2 => 30000", () => {
    expect(backoffMs(1, () => 0)).toBe(15_000);
    expect(backoffMs(2, () => 0)).toBe(30_000);
  });

  it("with random=1: attempt 1 => 30000", () => {
    expect(backoffMs(1, () => 1)).toBe(30_000);
  });

  it("never exceeds 30 minutes for large attempts", () => {
    const max = 30 * 60_000;
    expect(backoffMs(100, () => 1)).toBeLessThanOrEqual(max);
    expect(backoffMs(100, () => 0)).toBe(900_000);
  });
});

describe("emptyStats", () => {
  it("returns zeroed campaign stats shape", () => {
    expect(emptyStats()).toEqual({
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
    });
  });
});

describe("isTerminalSendState", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminalSendState("delivered")).toBe(true);
    expect(isTerminalSendState("bounced")).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminalSendState("sending")).toBe(false);
    expect(isTerminalSendState("queued")).toBe(false);
  });
});
