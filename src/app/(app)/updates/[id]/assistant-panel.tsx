"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, FileText, Loader2, Paperclip, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api, ApiError, apiStream, errorMessage } from "@/lib/api-client";
import type { AssistantStreamEvent } from "@/lib/content/assistant-progress";
import type { DocNode } from "@/lib/content/schema";
import type { AssistantMessage } from "@/lib/types";
import { AssistantTicker } from "./assistant-ticker";

type TurnResponse = {
  messages: AssistantMessage[];
  content: DocNode | null;
  filled: number;
  edited: number;
  remainingPrompts: number;
};

type Pending = { text: string; fileName: string | null; startedAt: number };

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const SUGGESTIONS = [
  "Draft this quarter's update from my notes below:\n\n",
  "Fill the TL;DR and the three metrics from what's already written.",
  "Tighten the Lowlights. Each one should say what slipped, why, and what changes.",
];

// Shared entry motion: strong ease-out, short, opacity only when the user prefers reduced motion.
const ENTER =
  "transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:transition-opacity motion-reduce:starting:translate-y-0";
const PRESS = "transition-transform duration-150 ease-out active:scale-[0.97]";

export function AssistantPanel({
  updateId,
  editable,
  enabled,
  getContent,
  beforeSend,
  onWorkingChange,
  onApply,
}: {
  updateId: string;
  editable: boolean;
  enabled: boolean;
  /** The editor's current document, sent with every turn. */
  getContent: () => DocNode;
  /** Saves pending edits and a restore point; resolves false when the draft can't be saved. */
  beforeSend: () => Promise<boolean>;
  onWorkingChange: (working: boolean) => void;
  onApply: (content: DocNode) => Promise<void>;
}) {
  const [messages, setMessages] = useState<AssistantMessage[] | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [clearOpen, setClearOpen] = useState(false);
  // Only replies that arrive while the panel is open animate in; saved history and the
  // author's own message (sent with Enter) appear instantly.
  const [liveReplies, setLiveReplies] = useState<Set<string>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ messages: AssistantMessage[] }>(`/api/updates/${updateId}/assistant`)
      .then((res) => !cancelled && setMessages(res.messages))
      .catch((err) => {
        if (!cancelled) {
          setMessages([]);
          toast.error(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [updateId]);

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const busy = pending !== null;
  const canSend = editable && enabled && !busy && (text.trim().length > 0 || file !== null);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      toast.error("Documents must be 4 MB or smaller.");
      return;
    }
    setFile(f);
    textRef.current?.focus();
  };

  const send = useCallback(async () => {
    if (!canSend) return;
    const message = text.trim();
    const attached = file;
    const saved = await beforeSend();
    if (!saved) {
      toast.error("Save your changes before asking the assistant.");
      return;
    }
    setPending({ text: message, fileName: attached?.name ?? null, startedAt: Date.now() });
    setSteps([]);
    setText("");
    setFile(null);
    onWorkingChange(true);
    try {
      const form = new FormData();
      form.set("content", JSON.stringify(getContent()));
      if (message) form.set("message", message);
      if (attached) form.set("file", attached);
      // Assigned inside the event callback, which control-flow narrowing does not see.
      let res = null as TurnResponse | null;
      await apiStream(`/api/updates/${updateId}/assistant`, form, (raw) => {
        const event = raw as AssistantStreamEvent;
        if (event.type === "step") setSteps((all) => [...all, event.label]);
        else if (event.type === "done") res = event.result as TurnResponse;
        else if (event.type === "error") throw new ApiError(event.status, "assistant_error", event.message);
      });
      if (!res) throw new ApiError(502, "assistant_error", "The assistant stopped before finishing. Try again.");
      const turn: TurnResponse = res;
      if (turn.content) await onApply(turn.content);
      setLiveReplies((ids) => new Set([...ids, ...turn.messages.filter((m) => m.role === "assistant").map((m) => m.id)]));
      setMessages((m) => [...(m ?? []), ...turn.messages]);
    } catch (err) {
      // Give the author their message back so nothing they typed is lost.
      setText(message);
      setFile(attached);
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
      onWorkingChange(false);
    }
  }, [canSend, text, file, beforeSend, onWorkingChange, getContent, updateId, onApply]);

  async function clear() {
    await api(`/api/updates/${updateId}/assistant`, { method: "DELETE" });
    setMessages([]);
    setClearOpen(false);
  }

  const empty = messages !== null && messages.length === 0 && !pending;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (editable && enabled && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!editable || !enabled) return;
        e.preventDefault();
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-live="polite">
        {messages === null ? (
          <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading conversation
          </div>
        ) : empty ? (
          <EmptyState
            enabled={enabled}
            editable={editable}
            onSuggest={(s) => {
              setText(s);
              requestAnimationFrame(() => {
                const el = textRef.current;
                if (el) {
                  el.focus();
                  el.setSelectionRange(s.length, s.length);
                }
              });
            }}
            onAttach={() => fileInput.current?.click()}
          />
        ) : (
          <ol className="space-y-5 pt-1">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} animate={liveReplies.has(m.id)} />
            ))}
            {pending && (
              <>
                <MessageItem message={{ role: "user", text: pending.text, fileName: pending.fileName, changeSummary: null }} animate={false} />
                <AssistantTicker steps={steps} startedAt={pending.startedAt} />
              </>
            )}
          </ol>
        )}
      </div>

      {editable ? (
        <div className="border-t bg-background p-3">
          {!enabled && (
            <p className="mb-2 text-xs text-muted-foreground">
              The assistant needs Vertex AI enabled for this project. See docs/ai-drafting.md.
            </p>
          )}
          <div className="rounded-xl border bg-background shadow-xs transition-[border-color,box-shadow] duration-150 ease focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            {file && (
              <div className={`flex items-center gap-2 border-b px-3 py-2 text-xs ${ENTER}`}>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                <button
                  type="button"
                  className={`rounded p-0.5 text-muted-foreground hover:text-foreground ${PRESS}`}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFile(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!enabled || busy}
              rows={2}
              placeholder={file ? "Anything Gemini should know about this document?" : "Paste notes, attach a document, or ask for a change"}
              aria-label="Message the assistant"
              className="field-sizing-content block max-h-48 min-h-14 w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={PRESS}
                aria-label="Attach a PDF, Word or text document"
                title="Attach a PDF, Word or text document (4 MB max)"
                disabled={!enabled || busy}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                className={`rounded-full ${PRESS}`}
                aria-label="Send"
                disabled={!canSend}
                onClick={() => void send()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Edits go straight into the update. Restore from History.</span>
            {messages && messages.length > 0 && (
              <button
                type="button"
                className={`inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-foreground ${PRESS}`}
                onClick={() => setClearOpen(true)}
                disabled={busy}
              >
                <Trash2 className="size-3" /> Clear
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">This update has been sent, so the assistant can&apos;t change it.</p>
      )}

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear this conversation?"
        description="The chat history for this update is deleted. The update itself doesn't change."
        confirmLabel="Clear conversation"
        destructive
        onConfirm={clear}
      />
    </div>
  );
}

function EmptyState({
  enabled,
  editable,
  onSuggest,
  onAttach,
}: {
  enabled: boolean;
  editable: boolean;
  onSuggest: (text: string) => void;
  onAttach: () => void;
}) {
  return (
    <div className="pt-2">
      <div className="flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Sparkles className="size-4" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">Draft with Gemini</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach a document or paste your notes. Gemini fills the template in the house voice and you keep editing in the
        document.
      </p>
      {editable && enabled && (
        <ul className="mt-4 space-y-1.5">
          <li>
            <button
              type="button"
              onClick={onAttach}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60 ${PRESS}`}
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              Draft from a PDF or Word document
            </button>
          </li>
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => onSuggest(s)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60 ${PRESS}`}
              >
                {s.split("\n")[0]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageItem({
  message,
  animate,
}: {
  message: Pick<AssistantMessage, "role" | "text" | "fileName" | "changeSummary">;
  animate: boolean;
}) {
  if (message.role === "user") {
    return (
      <li className="flex flex-col items-end gap-1">
        {message.fileName && (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
            <FileText className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{message.fileName}</span>
          </span>
        )}
        {message.text && (
          <p className="max-w-[90%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {message.text.length > 1200 ? `${message.text.slice(0, 1200)}…` : message.text}
          </p>
        )}
      </li>
    );
  }
  return (
    <li className={`flex gap-2 ${animate ? ENTER : ""}`}>
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
        {message.changeSummary && (
          <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand">
            <Check className="size-3" /> {message.changeSummary}
          </span>
        )}
      </div>
    </li>
  );
}
