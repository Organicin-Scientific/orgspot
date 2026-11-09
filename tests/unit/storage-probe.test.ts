import { describe, expect, it } from "vitest";
import { isStorageDisabledError } from "@/server/storage";

describe("isStorageDisabledError", () => {
  it("recognises missing-bucket style codes", () => {
    expect(isStorageDisabledError({ code: "404" })).toBe(true);
    expect(isStorageDisabledError({ code: "storage/not-found" })).toBe(true);
    expect(isStorageDisabledError({ code: "storage/bucket-not-found" })).toBe(true);
  });

  it("does not treat permission or credential failures as a missing bucket", () => {
    expect(isStorageDisabledError({ code: 403 })).toBe(false);
    expect(isStorageDisabledError({ code: "storage/unauthorized" })).toBe(false);
    expect(isStorageDisabledError(new Error("invalid_grant"))).toBe(false);
    expect(isStorageDisabledError(null)).toBe(false);
  });
});
