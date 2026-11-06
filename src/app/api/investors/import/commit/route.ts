import { ok, readJson, withAdmin } from "@/server/http/handler";
import { importCommitInput } from "@/server/http/schemas";
import { commitImport } from "@/server/import/commit";

export const maxDuration = 120;

export const POST = withAdmin(
  async ({ req, session }) => {
    const input = await readJson(req, importCommitInput, 4_500_000);
    const summary = await commitImport(input.rows, input.mapping, input.duplicateStrategy, input.groupIds, session.email);
    return ok(summary);
  },
  { rateLimit: "import" },
);
