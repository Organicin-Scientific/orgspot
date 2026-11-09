import { describe, expect, it } from "vitest";
import { suggestMapping } from "@/lib/import";

describe("suggestMapping", () => {
  it("maps HubSpot-style headers", () => {
    const m = suggestMapping(["Email", "First Name", "Last Name", "Company name"]);
    expect(m.email).toBe(0);
    expect(m.firstName).toBe(1);
    expect(m.lastName).toBe(2);
    expect(m.organization).toBe(3);
  });

  it("maps Google Contacts email column", () => {
    const m = suggestMapping(["First Name", "Last Name", "E-mail 1 - Value", "Organization Name"]);
    expect(m.email).toBe(2);
    expect(m.firstName).toBe(0);
    expect(m.lastName).toBe(1);
  });
});
