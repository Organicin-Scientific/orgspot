import { suggestMapping } from "@/lib/import";
import { badRequest } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";
import { MAX_IMPORT_BYTES, parseSpreadsheet } from "@/server/import/parse";

export const POST = withAdmin(
  async ({ req }) => {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64_000) {
      throw badRequest("Spreadsheets must be 4 MB or smaller");
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Choose a .csv or .xlsx file to upload");
    const sheet = await parseSpreadsheet(file);
    return ok({ ...sheet, suggestedMapping: suggestMapping(sheet.headers) });
  },
  { rateLimit: "import" },
);
