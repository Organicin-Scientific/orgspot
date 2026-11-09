import { parseDoc } from "@/lib/content/schema";
import { audit } from "@/server/audit";
import { aiDraftConfigured } from "@/server/ai/config";
import { draftUpdateFromSource } from "@/server/ai/draft-update";
import { sourceFromUpload, truncateNotes } from "@/server/ai/source-text";
import { getUpdate } from "@/server/db/updates";
import { badRequest, notFound, serviceUnavailable } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";

const MAX_BODY = 900_000;

type P = { id: string };

export const POST = withAdmin<P>(
  async ({ req, params, session }) => {
    if (!aiDraftConfigured()) {
      throw serviceUnavailable(
        "AI drafting is not configured. Enable Vertex AI, set AI_DRAFT_ENABLED=true, and ensure the Firebase service account can call Gemini.",
      );
    }

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY + 64_000) {
      throw badRequest("Request is too large.");
    }

    const update = await getUpdate(params.id);
    if (!update) throw notFound("Update not found");
    if (update.status !== "draft" && update.status !== "ready") {
      throw badRequest("Only drafts awaiting review can use AI drafting.");
    }

    const form = await req.formData();
    const contentRaw = form.get("content");
    if (typeof contentRaw !== "string" || !contentRaw.trim()) throw badRequest("Editor content is required.");

    let contentJson: unknown;
    try {
      contentJson = JSON.parse(contentRaw);
    } catch {
      throw badRequest("Editor content is invalid JSON.");
    }
    const parsed = parseDoc(contentJson);
    if (!parsed.ok) throw badRequest(parsed.error);

    const notesField = form.get("notes");
    const notes = truncateNotes(typeof notesField === "string" ? notesField : "");
    const file = form.get("file");
    const source = file instanceof File && file.size > 0 ? await sourceFromUpload(file) : null;

    if (!notes && !source) {
      throw badRequest("Add quarter notes, upload a source document, or both.");
    }

    const result = await draftUpdateFromSource({
      doc: parsed.doc,
      notes,
      source,
    });

    await audit({
      actorEmail: session.email,
      action: "update.ai_draft",
      resourceType: "update",
      resourceId: params.id,
      summary: `Gemini draft filled ${result.filled}/${result.promptCount} prompts (${result.remainingPrompts} left)`,
    });

    return ok({
      content: result.content,
      filled: result.filled,
      remainingPrompts: result.remainingPrompts,
      promptCount: result.promptCount,
    });
  },
  { rateLimit: "aiDraft" },
);
