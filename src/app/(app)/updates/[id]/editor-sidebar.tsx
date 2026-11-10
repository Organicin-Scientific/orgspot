"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, History, ImagePlus, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import type { DocNode } from "@/lib/content/schema";
import { formatDateTime } from "@/lib/format";
import type { AssetMeta, PdfDelivery, UpdateDoc, UpdateRevision } from "@/lib/types";
import { AssistantPanel } from "./assistant-panel";

export interface Meta {
  title: string;
  subject: string;
  previewText: string;
  pdfDelivery: PdfDelivery;
  bannerAssetId: string | null;
}

const PDF_OPTIONS: { value: PdfDelivery; label: string; help: string }[] = [
  { value: "attach", label: "Attach PDF", help: "Recommended. The full update is in the email and attached as a PDF." },
  { value: "link", label: "Link to PDF", help: "A personal download link that expires. Keeps the email small." },
  { value: "none", label: "No PDF", help: "Email body only." },
];

export interface AssistantBridge {
  enabled: boolean;
  getContent: () => DocNode;
  beforeSend: () => Promise<boolean>;
  onWorkingChange: (working: boolean) => void;
  onApply: (content: DocNode) => Promise<void>;
}

export function EditorSidebar({
  updateId,
  meta,
  editable,
  onChange,
  onRestored,
  versionRef,
  beforeRestore,
  assistant,
}: {
  updateId: string;
  meta: Meta;
  editable: boolean;
  onChange: (patch: Partial<Meta>) => void;
  onRestored: (u: UpdateDoc) => void;
  versionRef: React.RefObject<number>;
  beforeRestore: () => Promise<boolean>;
  assistant: AssistantBridge;
}) {
  const [tab, setTab] = useState(editable ? "assistant" : "email");
  return (
    <aside className="flex w-full shrink-0 flex-col border-t bg-background lg:sticky lg:top-[53px] lg:h-[calc(100svh-53px)] lg:w-96 lg:border-t-0 lg:border-l">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList className="m-3 grid w-[calc(100%-1.5rem)] shrink-0 grid-cols-3">
          <TabsTrigger value="assistant">
            <Sparkles /> Assistant
          </TabsTrigger>
          <TabsTrigger value="email">
            <FileText /> Email
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> History
          </TabsTrigger>
        </TabsList>
        {/* forceMount keeps the conversation and any half-typed message when switching tabs. */}
        <TabsContent value="assistant" forceMount className="flex h-[70svh] min-h-0 flex-col data-[state=inactive]:hidden lg:h-auto lg:flex-1">
          <AssistantPanel updateId={updateId} editable={editable} {...assistant} />
        </TabsContent>
        <TabsContent value="email" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8">
          <EmailFields meta={meta} editable={editable} onChange={onChange} />
        </TabsContent>
        <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          <Revisions updateId={updateId} editable={editable} onRestored={onRestored} versionRef={versionRef} beforeRestore={beforeRestore} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmailFields({ meta, editable, onChange }: { meta: Meta; editable: boolean; onChange: (patch: Partial<Meta>) => void }) {
  const [uploading, setUploading] = useState<"banner" | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  async function upload(file: File, kind: "banner") {
    setUploading(kind);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "image");
      const asset = await api<AssetMeta>("/api/assets", { form });
      onChange({ bannerAssetId: asset.id });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject line</Label>
        <Input
          id="subject"
          value={meta.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          disabled={!editable}
          maxLength={200}
          placeholder="e.g. Q3 investor update"
        />
        <p className="text-xs text-muted-foreground">{meta.subject.length}/200 · Required to send. Keep under ~60 characters for mobile.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="preview-text">Preview text</Label>
        <Textarea
          id="preview-text"
          value={meta.previewText}
          onChange={(e) => onChange({ previewText: e.target.value })}
          disabled={!editable}
          maxLength={250}
          rows={2}
          placeholder="Shown after the subject in most inboxes"
        />
      </div>

      <div className="space-y-2">
        <Label>PDF copy</Label>
        <RadioGroup value={meta.pdfDelivery} onValueChange={(v) => onChange({ pdfDelivery: v as PdfDelivery })} disabled={!editable}>
          {PDF_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2 rounded-md p-1 text-sm">
              <RadioGroupItem value={o.value} className="mt-0.5" />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.help}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label>Header image</Label>
        <input
          ref={bannerInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f, "banner");
            e.target.value = "";
          }}
        />
        {meta.bannerAssetId ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/assets/${meta.bannerAssetId}`} alt="Header image" className="w-full rounded-md border" />
            {editable && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => bannerInput.current?.click()} disabled={!!uploading}>
                  Replace
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onChange({ bannerAssetId: null })}>
                  Remove
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => bannerInput.current?.click()} disabled={!editable || !!uploading}>
            {uploading === "banner" ? <Loader2 className="animate-spin" /> : <ImagePlus />} Add a full-width image
          </Button>
        )}
      </div>

    </>
  );
}

type RevisionSummary = Omit<UpdateRevision, "content">;

function Revisions({
  updateId,
  editable,
  onRestored,
  versionRef,
  beforeRestore,
}: {
  updateId: string;
  editable: boolean;
  onRestored: (u: UpdateDoc) => void;
  versionRef: React.RefObject<number>;
  beforeRestore: () => Promise<boolean>;
}) {
  const [items, setItems] = useState<RevisionSummary[] | null>(null);
  const [restoring, setRestoring] = useState<RevisionSummary | null>(null);

  const load = () =>
    api<RevisionSummary[]>(`/api/updates/${updateId}/revisions`)
      .then(setItems)
      .catch((err) => toast.error(errorMessage(err)));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateId]);

  async function restore() {
    if (!restoring) return;
    try {
      if (!(await beforeRestore())) return;
      const u = await api<UpdateDoc>(`/api/updates/${updateId}/restore`, {
        body: { revisionId: restoring.id, expectedVersion: versionRef.current },
      });
      onRestored(u);
      toast.success("Earlier version restored");
      void load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Saved with ⌘S, and automatically every 10 minutes while editing.</p>
        <Button variant="ghost" size="xs" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {items === null ? (
        <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved versions yet.</p>
      ) : (
        <ol className="space-y-1">
          {items.map((r) => (
            <li key={r.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{formatDateTime(r.createdAt)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.reason === "manual" ? "Saved" : r.reason === "restore" ? "Restored" : "Autosave"} · {r.createdBy}
                </div>
              </div>
              {editable && (
                <Button variant="ghost" size="xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setRestoring(r)}>
                  <RotateCcw /> Restore
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Restore this version?"
        description={`The update will be replaced with the version from ${restoring ? formatDateTime(restoring.createdAt) : ""}. Your current content is saved as a version first, so you can switch back.`}
        confirmLabel="Restore"
        onConfirm={restore}
      />
    </div>
  );
}
