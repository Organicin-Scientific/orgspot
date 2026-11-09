"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import type { DocNode } from "@/lib/content/schema";

type DraftResponse = {
  content: DocNode;
  filled: number;
  remainingPrompts: number;
  promptCount: number;
};

export function AiDraftDialog({
  open,
  onOpenChange,
  updateId,
  getContent,
  onApply,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateId: string;
  getContent: () => DocNode;
  onApply: (content: DocNode) => void;
  enabled: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DraftResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null);
    setNotes("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  async function generate() {
    const file = fileRef.current?.files?.[0];
    if (!notes.trim() && !file) {
      toast.error("Add notes or choose a source file.");
      return;
    }
    setBusy(true);
    setPreview(null);
    try {
      const form = new FormData();
      form.set("content", JSON.stringify(getContent()));
      if (notes.trim()) form.set("notes", notes.trim());
      if (file) form.set("file", file);
      const res = await api<DraftResponse>(`/api/updates/${updateId}/ai-draft`, { form });
      setPreview(res);
      if (res.filled === 0) {
        toast.message("No prompts were filled. Add more detail in notes or the source file.");
      } else {
        toast.success(`Drafted ${res.filled} of ${res.promptCount} prompts`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!preview) return;
    onApply(preview.content);
    toast.success("Applied to editor — review before sending");
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            Draft with Gemini
          </DialogTitle>
          <DialogDescription>
            Keeps your update template. Gemini fills each <span className="italic">[Write: …]</span> prompt from your notes or
            document. Nothing is saved until you apply and the editor autosaves.
          </DialogDescription>
        </DialogHeader>

        {!enabled && (
          <Alert variant="destructive">
            <AlertDescription>
              AI drafting is not enabled on this deployment. Set <code className="text-xs">AI_DRAFT_ENABLED=true</code> and grant
              the Firebase service account Vertex AI access.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-draft-notes">Quarter notes</Label>
            <Textarea
              id="ai-draft-notes"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste bullets, metrics, wins, setbacks — anything you want reflected in the update."
              disabled={!enabled || busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-draft-file">Source document (optional)</Label>
            <Input
              ref={fileRef}
              id="ai-draft-file"
              type="file"
              accept=".pdf,.docx,.txt,.md,text/plain,application/pdf"
              disabled={!enabled || busy}
            />
            <p className="text-xs text-muted-foreground">PDF, Word (.docx), or plain text. Sent to Vertex Gemini 3.8 Flash in your GCP project.</p>
          </div>

          {preview && (
            <Alert>
              <AlertDescription>
                Filled <strong>{preview.filled}</strong> of <strong>{preview.promptCount}</strong> prompts.{" "}
                <strong>{preview.remainingPrompts}</strong> still need your review before send.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          {!preview ? (
            <Button type="button" onClick={() => void generate()} disabled={!enabled || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Generate draft
            </Button>
          ) : (
            <Button type="button" onClick={apply} disabled={busy}>
              Apply to editor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
