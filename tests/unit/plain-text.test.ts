import { describe, expect, it } from "vitest";
import { docToPlainText, wordCount } from "../../src/lib/content/plain-text";
import type { DocNode } from "../../src/lib/content/schema";

describe("docToPlainText", () => {
  it("numbers ordered lists from start and uses bullet prefix for bullet lists", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Third" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Fourth" }],
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "A" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "B" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const text = docToPlainText(doc, { withLinks: false });
    expect(text).toContain("3. Third");
    expect(text).toContain("4. Fourth");
    expect(text).toContain("- A");
    expect(text).toContain("- B");
  });

  it("renders links as text (url) when withLinks is true", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Click",
              marks: [{ type: "link", attrs: { href: "https://ex.com/x" } }],
            },
          ],
        },
      ],
    };
    expect(docToPlainText(doc, { withLinks: true })).toBe("Click (https://ex.com/x)");
  });

  it("renders metrics as Label (sublabel): value", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "metrics",
          attrs: {
            items: [
              { label: "ARR", sublabel: "YoY", value: "10%" },
              { label: "Burn", sublabel: "", value: "$0" },
            ],
          },
        },
      ],
    };
    const text = docToPlainText(doc);
    expect(text).toContain("ARR (YoY): 10%");
    expect(text).toContain("Burn: $0");
  });

  it("renders horizontal rule as dashed line", () => {
    const doc: DocNode = {
      type: "doc",
      content: [{ type: "horizontalRule", attrs: { variant: "short" } }],
    };
    expect(docToPlainText(doc)).toBe("----------");
  });
});

describe("wordCount", () => {
  it("counts words without link URLs", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "one two",
              marks: [{ type: "link", attrs: { href: "https://example.com/ignored" } }],
            },
          ],
        },
      ],
    };
    expect(wordCount(doc)).toBe(2);
  });
});
