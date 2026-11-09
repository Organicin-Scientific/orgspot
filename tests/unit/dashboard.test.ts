import { describe, expect, it } from "vitest";
import { emptyStats } from "@/lib/delivery";
import {
  daysSince,
  deliverabilityHealth,
  engagementFunnel,
  firstNameFromEmail,
  pickUpNext,
  sendsByMonth,
  stepIndex,
} from "@/lib/dashboard";
import type { UpdateSummary } from "@/lib/types";

const u = (id: string, status: UpdateSummary["status"]) => ({ id, status }) as UpdateSummary;

describe("pickUpNext", () => {
  it("prefers sending, then awaiting approval, then the newest draft", () => {
    expect(pickUpNext([u("a", "draft"), u("b", "ready"), u("c", "sending")])?.id).toBe("c");
    expect(pickUpNext([u("a", "draft"), u("b", "ready")])?.id).toBe("b");
    expect(pickUpNext([u("a", "sent"), u("b", "draft"), u("c", "draft")])?.id).toBe("b");
    expect(pickUpNext([u("a", "sent")])).toBeNull();
  });

  it("maps statuses onto the step tracker", () => {
    expect([stepIndex("draft"), stepIndex("ready"), stepIndex("sending"), stepIndex("sent")]).toEqual([0, 1, 2, 3]);
  });
});

describe("deliverabilityHealth", () => {
  it("is unknown with no sends", () => {
    expect(deliverabilityHealth([]).overall).toBe("unknown");
  });

  it("is healthy for a clean send", () => {
    const s = { ...emptyStats(), accepted: 100, delivered: 99, bounced: 1, opened: 50 };
    expect(deliverabilityHealth([s]).overall).toBe("healthy");
  });

  it("flags complaint rates at Gmail's 0.3% line as risk", () => {
    const s = { ...emptyStats(), accepted: 1000, delivered: 1000, complained: 3 };
    const h = deliverabilityHealth([s]);
    expect(h.metrics.find((m) => m.key === "complaint")?.level).toBe("risk");
    expect(h.overall).toBe("risk");
  });

  it("flags a 3% bounce rate as watch", () => {
    const s = { ...emptyStats(), accepted: 100, delivered: 97, bounced: 3 };
    expect(deliverabilityHealth([s]).metrics.find((m) => m.key === "bounce")?.level).toBe("watch");
  });
});

describe("engagementFunnel", () => {
  it("expresses each step as a share of messages sent", () => {
    const f = engagementFunnel({ ...emptyStats(), accepted: 200, delivered: 190, opened: 95, clicked: 19 });
    expect(f.map((s) => s.share)).toEqual([1, 0.95, 0.475, 0.095]);
  });
});

describe("sendsByMonth", () => {
  it("buckets approvals into the trailing twelve months", () => {
    const now = new Date(2026, 10, 9);
    const cells = sendsByMonth(
      [
        { approval: { approvedBy: "x", approvedAt: new Date(2026, 10, 2).toISOString() } },
        { approval: { approvedBy: "x", approvedAt: new Date(2026, 8, 15).toISOString() } },
        { approval: { approvedBy: "x", approvedAt: new Date(2025, 0, 1).toISOString() } },
        { approval: null },
      ],
      12,
      now,
    );
    expect(cells).toHaveLength(12);
    expect(cells[11].sends).toBe(1);
    expect(cells[9].sends).toBe(1);
    expect(cells.reduce((a, c) => a + c.sends, 0)).toBe(2);
  });
});

describe("small helpers", () => {
  it("derives a first name from an email when it looks like one", () => {
    expect(firstNameFromEmail("griffin@organicinscientific.com")).toBe("Griffin");
    expect(firstNameFromEmail("jane.doe@example.com")).toBe("Jane");
    expect(firstNameFromEmail("ops2@example.com")).toBe("");
  });

  it("counts whole days", () => {
    const now = Date.UTC(2026, 10, 9, 12);
    expect(daysSince(new Date(Date.UTC(2026, 10, 2, 13)).toISOString(), now)).toBe(6);
    expect(daysSince(null, now)).toBeNull();
  });
});
