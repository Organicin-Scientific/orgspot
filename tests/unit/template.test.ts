import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/lib/content/schema";
import { OPTIONAL_SECTIONS, starterDocument } from "../../src/lib/content/template";

describe("template documents", () => {
  it("starterDocument passes parseDoc", () => {
    const r = parseDoc(starterDocument());
    expect(r.ok).toBe(true);
  });

  it("every OPTIONAL_SECTIONS blocks array wrapped in a doc passes parseDoc", () => {
    for (const section of OPTIONAL_SECTIONS) {
      const r = parseDoc({ type: "doc", content: section.blocks });
      expect(r.ok, `section ${section.id} should parse`).toBe(true);
    }
  });
});
