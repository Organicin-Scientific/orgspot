import { describe, expect, it, vi } from "vitest";
import { contentDisposition } from "@/server/http/content-disposition";

vi.mock("@/server/env", () => ({ env: () => ({ APP_URL: "http://localhost:3000", CRON_SECRET: "x".repeat(32) }) }));
vi.mock("@/server/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe("contentDisposition", () => {
  it("produces a Latin-1 safe header for non-ASCII filenames", () => {
    const header = contentDisposition("attachment", "Q3 Update – Final.pdf");
    expect(header).toBe(`attachment; filename="Q3 Update _ Final.pdf"; filename*=UTF-8''Q3%20Update%20%E2%80%93%20Final.pdf`);
    // Headers construction throws on characters above U+00FF; this must not.
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });

  it("strips quotes, backslashes and line breaks", () => {
    const header = contentDisposition("inline", 'a"b\\c\r\nd.pdf');
    expect(header.startsWith(`inline; filename="abcd.pdf"`)).toBe(true);
  });

  it("falls back to a default name", () => {
    expect(contentDisposition("attachment", "  ")).toContain(`filename="download"`);
  });
});

describe("worker continuation", () => {
  it("parses the hop header defensively", async () => {
    const { parseHop } = await import("@/server/campaigns/continuation");
    expect(parseHop(null)).toBe(0);
    expect(parseHop("3")).toBe(3);
    expect(parseHop("-1")).toBe(0);
    expect(parseHop("1.5")).toBe(0);
    expect(parseHop("9999")).toBe(0);
  });

  it("hands off to the worker endpoint with the cron secret and next hop", async () => {
    const { triggerWorkerContinuation } = await import("@/server/campaigns/continuation");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await triggerWorkerContinuation(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3000/api/internal/worker");
    expect(init.headers.authorization).toBe(`Bearer ${"x".repeat(32)}`);
    expect(init.headers["x-worker-hop"]).toBe("3");
    vi.unstubAllGlobals();
  });

  it("stops chaining at the hop limit", async () => {
    const { triggerWorkerContinuation } = await import("@/server/campaigns/continuation");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await triggerWorkerContinuation(60);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
