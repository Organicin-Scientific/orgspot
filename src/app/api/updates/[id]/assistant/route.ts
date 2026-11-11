import { clampLabel, type AssistantStreamEvent } from "@/lib/content/assistant-progress";
import { parseDoc } from "@/lib/content/schema";
import { audit } from "@/server/audit";
import { changeSummary, runAssistantTurn } from "@/server/ai/assistant";
import { aiDraftConfigured } from "@/server/ai/config";
import { sourceFromUpload, truncateNotes } from "@/server/ai/source-text";
import { appendAssistantTurn, clearAssistantMessages, listAssistantMessages } from "@/server/db/assistant";
import { getUpdate } from "@/server/db/updates";
import { ApiError, badRequest, conflict, notFound, serviceUnavailable } from "@/server/http/errors";
import { log } from "@/server/logger";
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
 * JSON) and an optional `file` (PDF, Word, Markdown or text).
 *
 * Input errors return JSON as usual. Once the input is valid the response is a stream of
 * newline-delimited events: `step` labels as the turn progresses, then one `done` carrying the
 * saved user and assistant messages and the revised document, or one `error`.
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
    const upload = file instanceof File && file.size > 0 ? file : null;
    if (!message && !upload) throw badRequest("Type a message or attach a document.");

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: AssistantStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const step = (label: string) => send({ type: "step", label: clampLabel(label) });
        try {
          if (upload) step(`Reading ${upload.name}`);
          const source = upload ? await sourceFromUpload(upload) : null;
          if (source?.kind === "text") {
            const words = source.text.split(/\s+/).filter(Boolean).length;
            step(`Read ${source.filename} · ${words.toLocaleString("en-US")} words`);
          } else if (source?.kind === "pdf") {
            step(`Attached ${source.filename} for Gemini to read`);
          }

          const history = await listAssistantMessages(params.id);
          const result = await runAssistantTurn({ doc: doc.doc, history, message, source, onStep: step });
          const summary = changeSummary(result);

          step(result.content ? "Saving the changes" : "Saving the conversation");
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

          send({
            type: "done",
            result: {
              messages,
              content: result.content,
              filled: result.filled,
              removed: result.removed,
              edited: result.edited,
              remainingPrompts: result.remainingPrompts,
            },
          });
        } catch (err) {
          if (err instanceof ApiError) send({ type: "error", status: err.status, message: err.message });
          else {
            log.error("assistant.turn_failed", { err });
            send({ type: "error", status: 500, message: "Something went wrong. Please try again." });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-accel-buffering": "no",
      },
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
