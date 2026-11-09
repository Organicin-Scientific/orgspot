"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import DragHandle from "@tiptap/extension-drag-handle-react";
import DOMPurify from "dompurify";
import { AlertTriangle, Check, ChevronLeft, Copy, Eye, GripVertical, Loader2, Send, SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import { editorExtensions } from "@/components/editor/extensions";
import { EditorToolbar } from "@/components/editor/toolbar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import type { DocNode } from "@/lib/content/schema";
import { relativeTime } from "@/lib/format";
import type { Branding, PdfDelivery, UpdateDoc } from "@/lib/types";
import { BlocksMenuItems, SaveBlockDialog, useReusableBlocks } from "./blocks";
import { EditorSidebar, type Meta } from "./editor-sidebar";
import { PreviewDialog } from "./preview-dialog";
import { TestSendDialog } from "./test-send-dialog";
import { DEFAULT_LOGO_PATH } from "@/lib/brand";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const EDITABLE = new Set(["draft", "ready"]);

export function UpdateEditor({
  initial,
  branding,
  postalAddress,
  footerNote,
  adminEmail,
  liveSending,
}: {
  initial: UpdateDoc;
  branding: Branding;
  postalAddress: string;
  footerNote: string;
  adminEmail: string;
  liveSending: boolean;
}) {
  const router = useRouter();
  const editable = EDITABLE.has(initial.status);
  const [meta, setMeta] = useState<Meta>({
    title: initial.title,
    subject: initial.subject,
    previewText: initial.previewText,
    pdfDelivery: initial.pdfDelivery,
    bannerAssetId: initial.bannerAssetId,
    attachmentIds: initial.attachmentIds,
  });
  const [status, setStatus] = useState(initial.status);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState(initial.updatedAt);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveBlockOpen, setSaveBlockOpen] = useState(false);
  const reusable = useReusableBlocks();

  const versionRef = useRef(initial.version);
  const metaRef = useRef(meta);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const loadedRef = useRef(false);

  const save = useCallback((revision: "autosave" | "manual" = "autosave", opts: { silent?: boolean } = {}) => {
    const run = async () => {
      const editor = editorRef.current;
      if (!editor || conflictRef.current) return;
      if (revision === "autosave" && !dirtyRef.current) return;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        const m = metaRef.current;
        const updated = await api<UpdateDoc>(`/api/updates/${initial.id}`, {
          method: "PATCH",
          body: { expectedVersion: versionRef.current, ...m, content: editor.getJSON(), revision },
        });
        versionRef.current = updated.version;
        setStatus(updated.status);
        setSavedAt(updated.updatedAt);
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        if (revision === "manual" && !opts.silent) toast.success("Version saved");
      } catch (err) {
        dirtyRef.current = true;
        if (err instanceof ApiError && err.status === 409) {
          conflictRef.current = true;
          setSaveState("conflict");
        } else {
          setSaveState("error");
          toast.error(errorMessage(err));
        }
      }
    };
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }, [initial.id]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (!conflictRef.current) setSaveState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save("autosave"), 1200);
  }, [save]);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save("autosave");
    return !dirtyRef.current && !conflictRef.current;
  }, [save]);

  const editor = useEditor({
    extensions: editorExtensions(),
    content: initial.content,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "ProseMirror", "aria-label": "Update content", spellcheck: "true" },
      transformPastedHTML: (html) =>
        DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "svg", "video", "audio"] }),
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged && loadedRef.current) scheduleSave();
    },
    onCreate: () => {
      setTimeout(() => (loadedRef.current = true), 0);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const updateMeta = (patch: Partial<Meta>) => {
    setMeta((m) => {
      const next = { ...m, ...patch };
      metaRef.current = next;
      return next;
    });
    scheduleSave();
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (editable) void save("manual");
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKey);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editable, save]);

  async function goToSend() {
    setLeaving(true);
    const ok = await flush();
    if (!ok) {
      setLeaving(false);
      toast.error("Save your changes before reviewing the send.");
      return;
    }
    router.push(`/updates/${initial.id}/send`);
  }

  async function duplicate() {
    try {
      const copy = await api<UpdateDoc>(`/api/updates/${initial.id}/duplicate`, { method: "POST", body: {} });
      router.push(`/updates/${copy.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function applyRestored(u: UpdateDoc) {
    versionRef.current = u.version;
    const m: Meta = {
      title: u.title,
      subject: u.subject,
      previewText: u.previewText,
      pdfDelivery: u.pdfDelivery as PdfDelivery,
      bannerAssetId: u.bannerAssetId,
      attachmentIds: u.attachmentIds,
    };
    metaRef.current = m;
    setMeta(m);
    editor?.commands.setContent(u.content, { emitUpdate: false });
    dirtyRef.current = false;
    setSaveState("saved");
    setSavedAt(u.updatedAt);
    setStatus(u.status);
  }

  const docStyle = { "--doc-brand": branding.primaryColor, "--doc-text": branding.textColor } as React.CSSProperties;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="z-30 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur md:sticky md:top-0">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to updates">
          <Link href="/updates" onClick={() => void flush()}>
            <ChevronLeft />
          </Link>
        </Button>
        <input
          value={meta.title}
          onChange={(e) => updateMeta({ title: e.target.value })}
          disabled={!editable}
          placeholder="Untitled update"
          aria-label="Update title"
          maxLength={200}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none hover:bg-muted/60 focus:bg-muted/60 disabled:hover:bg-transparent"
        />
        <StatusBadge status={status} />
        <SaveIndicator state={saveState} savedAt={savedAt} editable={editable} />
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={async () => { await flush(); setPreviewOpen(true); }}>
            <Eye /> Preview
          </Button>
          {editable ? (
            <>
              <Button variant="outline" size="sm" onClick={async () => { await flush(); setTestOpen(true); }}>
                <SendHorizonal /> Send test
              </Button>
              <Button size="sm" onClick={goToSend} disabled={leaving || saveState === "conflict"}>
                {leaving ? <Loader2 className="animate-spin" /> : <Send />}
                Review &amp; send
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={duplicate}>
              <Copy /> Duplicate to edit
            </Button>
          )}
        </div>
      </header>

      {saveState === "conflict" && (
        <Banner tone="danger">
          This update was changed in another tab or by another administrator. Your latest edits were not saved.{" "}
          <button className="font-medium underline" onClick={() => window.location.reload()}>
            Reload the latest version
          </button>
        </Banner>
      )}
      {status === "ready" && saveState !== "conflict" && (
        <Banner tone="info">
          A send has been prepared for this update and is awaiting confirmation. Any edit cancels it and you will need to review again.{" "}
          <Link href={`/updates/${initial.id}/send`} className="font-medium underline">
            Continue to confirmation
          </Link>
        </Banner>
      )}
      {!editable && (
        <Banner tone="info">
          This update has been {status === "sending" ? "approved and is sending" : status}. Sent updates cannot be edited.{" "}
          {initial.sentCampaignId && (
            <Link href={`/analytics/${initial.sentCampaignId}`} className="font-medium underline">
              View delivery and engagement
            </Link>
          )}
        </Banner>
      )}

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 bg-muted/40 px-3 pb-16 sm:px-6">
          {editor && editable && (
            <div className="sticky top-14 z-20 mx-auto max-w-[760px] py-3 md:top-[53px]">
              <EditorToolbar editor={editor} brandColor={branding.primaryColor} extraInsert={
                  <BlocksMenuItems editor={editor} blocks={reusable.blocks} remove={reusable.remove} onRequestSave={() => setSaveBlockOpen(true)} />
                }
              />
            </div>
          )}
          <article className="doc-page mx-auto mt-3 max-w-[760px] rounded-sm border border-black/5 shadow-sm" style={docStyle}>
            <div className="px-6 pt-10 pb-4 text-center sm:px-14">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoAssetId ? `/api/assets/${branding.logoAssetId}` : DEFAULT_LOGO_PATH}
                alt={branding.companyName}
                className="mx-auto h-8 w-auto max-w-full"
              />
            </div>
            {meta.bannerAssetId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/assets/${meta.bannerAssetId}`} alt="" className="block w-full" />
            )}
            <div className="relative px-6 py-6 sm:px-14">
              {editor && editable && (
                <DragHandle editor={editor}>
                  <div className="flex size-6 cursor-grab items-center justify-center rounded text-[#9a9a9a] hover:bg-[#eef1f0] hover:text-[#444]" aria-label="Drag to move block">
                    <GripVertical className="size-4" />
                  </div>
                </DragHandle>
              )}
              <EditorContent editor={editor} />
            </div>
            <footer className="border-t border-[#ececec] px-6 py-6 text-center text-[12px] leading-relaxed text-[#777] sm:px-14">
              {footerNote && <p>{footerNote}</p>}
              <p>{postalAddress || "Add your postal address in Settings"}</p>
              <p className="mt-1">
                <span className="underline">Unsubscribe</span>
              </p>
            </footer>
          </article>
        </div>
        <EditorSidebar
          updateId={initial.id}
          meta={meta}
          editable={editable}
          onChange={updateMeta}
          onRestored={applyRestored}
          versionRef={versionRef}
          beforeRestore={async () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            await save("manual", { silent: true });
            return !conflictRef.current;
          }}
        />
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} updateId={initial.id} meta={meta} getContent={() => (editor?.getJSON() ?? initial.content) as DocNode} />
      {editor && <SaveBlockDialog open={saveBlockOpen} onOpenChange={setSaveBlockOpen} editor={editor} onSaved={reusable.add} />}
      <TestSendDialog open={testOpen} onOpenChange={setTestOpen} updateId={initial.id} defaultEmail={adminEmail} liveSending={liveSending} />
    </div>
  );
}

function SaveIndicator({ state, savedAt, editable }: { state: SaveState; savedAt: string; editable: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!editable) return null;
  const content =
    state === "saving" ? (
      <>
        <Loader2 className="size-3 animate-spin" /> Saving…
      </>
    ) : state === "dirty" ? (
      "Unsaved changes"
    ) : state === "error" ? (
      <span className="text-destructive">Not saved — retrying on next edit</span>
    ) : state === "conflict" ? (
      <span className="text-destructive">Not saved</span>
    ) : (
      <>
        <Check className="size-3" /> Saved {relativeTime(savedAt)}
      </>
    );
  return (
    <span
      data-testid="update-save-indicator"
      data-save-state={state}
      className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"
      aria-live="polite"
    >
      {content}
    </span>
  );
}

function Banner({ tone, children }: { tone: "info" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "danger"
          ? "flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm"
          : "flex items-start gap-2 border-b bg-sky-500/10 px-4 py-2 text-sm"
      }
      role={tone === "danger" ? "alert" : "status"}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}
