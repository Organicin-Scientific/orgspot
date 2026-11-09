import { ok, readJson, withAdmin } from "@/server/http/handler";
import { importPreviewInput } from "@/server/http/schemas";
import { previewImport } from "@/server/import/commit";

export const POST = withAdmin(
  async ({ req }) => {
    const { rows, mapping } = await readJson(req, importPreviewInput, 4_500_000);
    return ok(await previewImport(rows, mapping));
  },
  { rateLimit: "import" },
);
