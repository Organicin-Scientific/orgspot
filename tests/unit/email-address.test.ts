import { describe, expect, it } from "vitest";
import { emailDomain, isValidEmail, normalizeEmail } from "../../src/lib/email-address";

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases ASCII", () => {
    expect(normalizeEmail("  User@Example.COM \t")).toBe("user@example.com");
  });
});

describe("isValidEmail", () => {
  it("accepts plus addressing and dotted local parts", () => {
    expect(isValidEmail("foo+bar@example.com")).toBe(true);
    expect(isValidEmail("first.last@sub.mail.example.co.uk")).toBe(true);
  });

  it("accepts subdomain labels and normalizes via trim for length check", () => {
    expect(isValidEmail("  a@b.co  ")).toBe(true);
  });

  it("rejects addresses without @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });

  it("rejects double dots in local part", () => {
    expect(isValidEmail("a..b@example.com")).toBe(false);
  });

  it("rejects leading dot in local part", () => {
    expect(isValidEmail(".user@example.com")).toBe(false);
  });

  it("rejects whitespace in address", () => {
    expect(isValidEmail("user name@example.com")).toBe(false);
  });

  it("rejects missing TLD (single label domain)", () => {
    expect(isValidEmail("user@localhost")).toBe(false);
  });

  it("rejects overall length > 254 characters", () => {
    const local = "a".repeat(64);
    const domain = "b." + "c".repeat(200) + ".de";
    const addr = `${local}@${domain}`;
    expect(addr.length).toBeGreaterThan(254);
    expect(isValidEmail(addr)).toBe(false);
  });

  it("rejects local part > 64 characters", () => {
    const local = "a".repeat(65);
    expect(isValidEmail(`${local}@x.example.com`)).toBe(false);
  });
});

describe("emailDomain", () => {
  it("returns normalized domain part", () => {
    expect(emailDomain("  Person@Sub.EXAMPLE.com ")).toBe("sub.example.com");
  });

  it("returns empty string when @ is missing", () => {
    expect(emailDomain("nodomain")).toBe("");
  });
});
