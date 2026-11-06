"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import type { InvestorGroup } from "@/lib/types";

type FormMode = "create" | "edit";

export function GroupsManager({ initialGroups }: { initialGroups: InvestorGroup[] }) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<InvestorGroup | null>(null);

  function openCreate() {
    setFormMode("create");
    setEditingId(null);
    setName("");
    setDescription("");
    setFormOpen(true);
  }

  function openEdit(g: InvestorGroup) {
    setFormMode("edit");
    setEditingId(g.id);
    setName(g.name);
    setDescription(g.description);
    setFormOpen(true);
  }

  async function saveGroup() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Enter a group name");
      return;
    }
    setSaving(true);
    try {
      if (formMode === "create") {
        const created = await api<InvestorGroup>("/api/groups", { body: { name: trimmedName, description: description.trim() } });
        setGroups((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Group created");
      } else if (editingId) {
        const updated = await api<InvestorGroup>(`/api/groups/${editingId}`, {
          method: "PATCH",
          body: { name: trimmedName, description: description.trim() },
        });
        setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)).sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Group updated");
      }
      setFormOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api(`/api/groups/${pendingDelete.id}`, { method: "DELETE" });
      setGroups((prev) => prev.filter((g) => g.id !== pendingDelete.id));
      toast.success("Group deleted");
      setPendingDelete(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Groups"
        description="Organise investors into distribution lists."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus /> New group
          </Button>
        }
      >
        <Link href="/investors" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Investors
        </Link>
      </PageHeader>

      <div className="space-y-4 px-6 py-5">
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead className="text-right tabular-nums">Members</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">
                    <Link href={`/investors?group=${encodeURIComponent(g.id)}`} className="text-primary hover:underline">
                      {g.name}
                    </Link>
                    <div className="mt-0.5 text-xs font-normal text-muted-foreground md:hidden">{g.description || "—"}</div>
                  </TableCell>
                  <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">{g.description || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{g.memberCount}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(g)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(g)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {groups.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No groups yet"
                description="Create a group to target a subset of investors when sending updates."
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus /> New group
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{formMode === "create" ? "New group" : "Edit group"}</DialogTitle>
            <DialogDescription>
              {formMode === "create" ? "Add a distribution list you can select when sending an update." : "Update the group name or description."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="group-name">Name</Label>
              <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seed investors" autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional context for your team"
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveGroup()} disabled={saving}>
              {formMode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete group"
        description={
          pendingDelete ? (
            <>
              Delete “{pendingDelete.name}”? Contacts stay in the directory; they are only removed from this group.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete group"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
