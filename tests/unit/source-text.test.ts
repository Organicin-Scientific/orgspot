import { describe, expect, it } from "vitest";
import { sourceFromUpload } from "../../src/server/ai/source-text";

const md = "# Q3 notes\n\n- Signed a $120K SOW\n- Launch moved to Q4\n";

describe("sourceFromUpload with Markdown", () => {
  it.each([
    ["notes.md", "text/markdown"],
    ["notes.md", ""],
    ["notes.markdown", ""],
    ["notes.md", "text/x-markdown"],
    ["notes.MD", "application/octet-stream"],
  ])("reads %s (%s) as text", async (name, type) => {
    const source = await sourceFromUpload(new File([md], name, { type }));
    expect(source).toEqual({ kind: "text", text: md, filename: name });
  });

  it("rejects an empty Markdown file", async () => {
    await expect(sourceFromUpload(new File([""], "empty.md", { type: "text/markdown" }))).rejects.toThrow(/empty/);
  });

  it("names Markdown in the unsupported-type error", async () => {
    await expect(sourceFromUpload(new File(["x"], "deck.key", { type: "application/octet-stream" }))).rejects.toThrow(/Markdown/);
  });
});
