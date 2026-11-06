"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, History, ImagePlus, Loader2, Paperclip, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { AssetMeta, PdfDelivery, UpdateDoc, UpdateRevision } from "@/lib/types";

export interface Meta {
  title: string;
  subject: string;
  previewText: string;
  pdfDelivery: PdfDelivery;
  bannerAssetId: string | null;
  attachmentIds: string[];
}

const PDF_OPTIONS: { value: PdfDelivery; label: string; help: string }[] = [
  { value: "attach", label: "Attach PDF", help: "Recommended. The full update is in the email and attached as a PDF." },
  { value: "link", label: "Link to PDF", help: "A personal download link that expires. Keeps the email small." },
  { value: "none", label: "No PDF", help: "Email body only." },
];

export function EditorSidebar({
  updateId,
  meta,
  editable,
  onChange,
  onRestored,
  versionRef,
  beforeRestore,
}: {
  updateId: string;
  meta: Meta;
  editable: boolean;
  onChange: (patch: Partial<Meta>) => void;
  onRestored: (u: UpdateDoc) => void;
  versionRef: React.RefObject<number>;
  beforeRestore: () => Promise<boolean>;
}) {
  return (
    <aside className="w-full shrink-0 border-t bg-background lg:sticky lg:top-[53px] lg:h-[calc(100svh-53px)] lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      <Tabs defaultValue="email" className="gap-0">
        <TabsList className="m-3 grid w-[calc(100%-1.5rem)] grid-cols-2">
          <TabsTrigger value="email">
            <FileText /> Email
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="space-y-6 px-4 pb-8">
          <EmailFields meta={meta} editable={editable} onChange={onChange} />
        </TabsContent>
        <TabsContent value="history" className="px-4 pb-8">
          <Revisions updateId={updateId} editable={editable} onRestored={onRestored} versionRef={versionRef} beforeRestore={beforeRestore} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmailFields({ meta, editable, onChange }: { meta: Meta; editable: boolean; onChange: (patch: Partial<Meta>) => void }) {
  const [known, setKnown] = useState<AssetMeta[]>([]);
  const [uploading, setUploading] = useState<"banner" | "attachment" | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const attachments = meta.attachmentIds.map((id) => known.find((a) => a.id === id)).filter((a): a is AssetMeta => !!a);
  const missingKey = meta.attachmentIds.filter((id) => !known.some((a) => a.id === id)).join(",");

  useEffect(() => {
    if (!missingKey) return;
    api<AssetMeta[]>(`/api/assets?ids=${encodeURIComponent(missingKey)}`)
      .then((found) => setKnown((k) => [...k, ...found.filter((f) => !k.some((x) => x.id === f.id))]))
      .catch(() => undefined);
  }, [missingKey]);

  async function upload(file: File, kind: "banner" | "attachment") {
    setUploading(kind);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind === "banner" ? "image" : "attachment");
      const asset = await api<AssetMeta>("/api/assets", { form });
      if (kind === "banner") onChange({ bannerAssetId: asset.id });
      else {
        setKnown((a) => [...a, asset]);
        onChange({ attachmentIds: [...meta.attachmentIds, asset.id] });
      }
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

      <div className="space-y-2">
        <Label>Additional files</Label>
        <input
          ref={attachInput}
          type="file"
          accept=".pdf,.docx,.xlsx,.pptx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f, "attachment");
            e.target.value = "";
          }}
        />
        {attachments.length > 0 && (
          <ul className="space-y-1">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${a.filename}`}
                    onClick={() => onChange({ attachmentIds: meta.attachmentIds.filter((x) => x !== a.id) })}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => attachInput.current?.click()}
          disabled={!editable || !!uploading || meta.attachmentIds.length >= 10}
        >
          {uploading === "attachment" ? <Loader2 className="animate-spin" /> : <Paperclip />} Add file
        </Button>
        <p className="text-xs text-muted-foreground">Shared as personal download links. PDF, Word, Excel or PowerPoint, up to 20 MB.</p>
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
