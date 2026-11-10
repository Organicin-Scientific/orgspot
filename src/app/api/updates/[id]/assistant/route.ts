import { parseDoc } from "@/lib/content/schema";
import { audit } from "@/server/audit";
import { changeSummary, runAssistantTurn } from "@/server/ai/assistant";
import { aiDraftConfigured } from "@/server/ai/config";
import { sourceFromUpload, truncateNotes } from "@/server/ai/source-text";
import { appendAssistantTurn, clearAssistantMessages, listAssistantMessages } from "@/server/db/assistant";
import { getUpdate } from "@/server/db/updates";
import { badRequest, conflict, notFound, serviceUnavailable } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";

const MAX_BODY = 4_600_000;
const EDITABLE = new Set(["draft", "ready"]);

type P = { id: string };

/** The saved conversation for this update, oldest first. */
export const GET = withAdmin<P>(async ({ params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  return ok({ messages: await listAssistantMessages(params.id), enabled: aiDraftConfigured() });
});

/**
 * One chat turn. Form fields: `message` (text), `content` (the editor's current document as
 * JSON) and an optional `file` (PDF, Word or text). Returns the saved user and assistant
 * messages, plus the revised document when the assistant changed it.
 */
export const POST = withAdmin<P>(
  async ({ req, params, session }) => {
    if (!aiDraftConfigured()) {
      throw serviceUnavailable("The assistant is not configured. Enable Vertex AI and set AI_DRAFT_ENABLED=true.");
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw badRequest("That file is too large. Documents must be 4 MB or smaller.");

    const update = await getUpdate(params.id);
    if (!update) throw notFound("Update not found");
    if (!EDITABLE.has(update.status)) throw conflict("Sent updates can't be edited.");

    const form = await req.formData();
    const contentRaw = form.get("content");
    if (typeof contentRaw !== "string" || !contentRaw.trim()) throw badRequest("Editor content is required.");
    let contentJson: unknown;
    try {
      contentJson = JSON.parse(contentRaw);
    } catch {
      throw badRequest("Editor content is invalid JSON.");
    }
    const doc = parseDoc(contentJson);
    if (!doc.ok) throw badRequest(doc.error);

    const messageField = form.get("message");
    const message = truncateNotes(typeof messageField === "string" ? messageField : "");
    const file = form.get("file");
    const source = file instanceof File && file.size > 0 ? await sourceFromUpload(file) : null;
    if (!message && !source) throw badRequest("Type a message or attach a document.");

    const history = await listAssistantMessages(params.id);
    const result = await runAssistantTurn({ doc: doc.doc, history, message, source });
    const summary = changeSummary(result);

    const messages = await appendAssistantTurn(
      params.id,
      session.email,
      { text: message, fileName: source?.filename ?? null },
      { text: result.reply, changeSummary: summary },
    );

    await audit({
      actorEmail: session.email,
      action: "update.assistant",
      resourceType: "update",
      resourceId: params.id,
      summary: `Assistant turn${source ? " with a document" : ""}: ${summary ?? "no document changes"} (${result.remainingPrompts} prompts left)`,
    });

    return ok({
      messages,
      content: result.content,
      filled: result.filled,
      edited: result.edited,
      remainingPrompts: result.remainingPrompts,
    });
  },
  { rateLimit: "aiDraft" },
);

/** Clear the conversation. The update's content is untouched. */
export const DELETE = withAdmin<P>(async ({ params, session }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  await clearAssistantMessages(params.id);
  await audit({
    actorEmail: session.email,
    action: "update.assistant_clear",
    resourceType: "update",
    resourceId: params.id,
    summary: "Cleared the assistant conversation",
  });
  return ok({ cleared: true });
});
