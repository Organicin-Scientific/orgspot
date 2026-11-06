"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Blocks, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import type { ContentBlock } from "@/lib/types";

export function useReusableBlocks() {
  const [blocks, setBlocks] = useState<ContentBlock[] | null>(null);

  useEffect(() => {
    api<ContentBlock[]>("/api/blocks")
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }, []);

  async function remove(id: string) {
    try {
      await api(`/api/blocks/${id}`, { method: "DELETE" });
      setBlocks((b) => b?.filter((x) => x.id !== id) ?? null);
      toast.success("Block deleted");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return { blocks, remove, add: (b: ContentBlock) => setBlocks((list) => [b, ...(list ?? [])]) };
}

/** "Insert" menu entries for reusable content blocks (e.g. the standard company description). */
export function BlocksMenuItems({
  editor,
  blocks,
  remove,
  onRequestSave,
}: {
  editor: Editor;
  blocks: ContentBlock[] | null;
  remove: (id: string) => Promise<void>;
  onRequestSave: () => void;
}) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Blocks /> Reusable blocks
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          {blocks === null ? (
            <DropdownMenuItem disabled>
              <Loader2 className="animate-spin" /> Loading…
            </DropdownMenuItem>
          ) : blocks.length === 0 ? (
            <DropdownMenuItem disabled>No saved blocks yet</DropdownMenuItem>
          ) : (
            blocks.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => editor.chain().focus().insertContent(b.content.content).run()} className="group">
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <button
                  type="button"
                  aria-label={`Delete block ${b.name}`}
                  className="rounded p-0.5 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void remove(b.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={editor.state.selection.empty} onSelect={onRequestSave}>
            <Save /> Save selection as block…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export function SaveBlockDialog({
  open,
  onOpenChange,
  editor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editor: Editor;
  onSaved: (b: ContentBlock) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const slice = editor.state.selection.content().content.toJSON() as unknown[] | null;
    if (!slice?.length) {
      toast.error("Select some content first.");
      return;
    }
    setBusy(true);
    try {
      const block = await api<ContentBlock>("/api/blocks", { body: { name, content: { type: "doc", content: slice } } });
      onSaved(block);
      toast.success("Block saved");
      setName("");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Save as reusable block</DialogTitle>
            <DialogDescription>Reuse standard sections such as the company description or disclaimers in future updates.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="block-name">Name</Label>
            <Input id="block-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="e.g. What we do" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Save block
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
