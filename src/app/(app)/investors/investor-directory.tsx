"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderMinus,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Search,
  ShieldOff,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api-client";
import { fullName } from "@/lib/format";
import { INVESTOR_STATUSES, type Investor, type InvestorGroup, type Page } from "@/lib/types";
import { InvestorFormSheet } from "./investor-form";

const ALL = "__all";

type BulkType = "addToGroup" | "removeFromGroup" | "suppress" | "delete";

const EMPTY_SET: Set<string> = new Set();

export function InvestorDirectory({
  groups: initialGroups,
  categories,
  initialGroupId,
}: {
  groups: InvestorGroup[];
  categories: string[];
  initialGroupId: string | null;
}) {
  const router = useRouter();
  const [groups] = useState(initialGroups);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [groupId, setGroupId] = useState<string>(initialGroupId ?? ALL);
  const [reloadTick, setReloadTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<{ type: BulkType; groupId?: string } | null>(null);

  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const filtersActive = debouncedQ || status !== ALL || category !== ALL || groupId !== ALL;

  // Paging and selection belong to one filter combination; changing a filter starts over.
  const filterKey = JSON.stringify([debouncedQ, status, category, groupId]);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({ key: filterKey, cursors: [null] });
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: filterKey, ids: new Set() });
  const cursors = pager.key === filterKey ? pager.cursors : [null];
  const selected = selection.key === filterKey ? selection.ids : EMPTY_SET;
  const setCursors = (fn: (c: (string | null)[]) => (string | null)[]) => setPager({ key: filterKey, cursors: fn(cursors) });
  const setSelected = (next: Set<string> | ((s: Set<string>) => Set<string>)) =>
    setSelection({ key: filterKey, ids: typeof next === "function" ? next(selected) : next });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (status !== ALL) params.set("status", status);
  if (category !== ALL) params.set("category", category);
  if (groupId !== ALL) params.set("groupId", groupId);
  const cursor = cursors[cursors.length - 1];
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "50");
  const requestKey = `${params}#${reloadTick}`;
  const [result, setResult] = useState<{ key: string; data: Page<Investor> } | null>(null);
  const page = result?.data ?? null;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const ctrl = new AbortController();
    api<Page<Investor>>(`/api/investors?${requestKey.split("#")[0]}`, { signal: ctrl.signal })
      .then((data) => setResult({ key: requestKey, data }))
      .catch((err) => !ctrl.signal.aborted && toast.error(errorMessage(err)));
    return () => ctrl.abort();
  }, [requestKey]);

  const load = () => setReloadTick((t) => t + 1);

  const items = page?.items ?? [];
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));

  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      if (allOnPage) items.forEach((i) => next.delete(i.id));
      else items.forEach((i) => next.add(i.id));
      return next;
    });
  }

  async function runBulk() {
    if (!pendingBulk) return;
    const ids = [...selected];
    try {
      const action =
        pendingBulk.type === "addToGroup" || pendingBulk.type === "removeFromGroup"
          ? { type: pendingBulk.type, groupId: pendingBulk.groupId }
          : { type: pendingBulk.type };
      const res = await api<{ changed: number }>("/api/investors/bulk", { body: { ids, action } });
      toast.success(`${res.changed} contact${res.changed === 1 ? "" : "s"} updated`);
      setSelected(new Set());
      load();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const exportHref = `/api/investors/export${groupId !== ALL ? `?groupId=${encodeURIComponent(groupId)}` : ""}`;
  const bulkCopy = pendingBulk ? bulkDescription(pendingBulk, selected.size, groupName) : null;

  return (
    <>
      <PageHeader
        title="Investors"
        description="Everyone who can receive investor updates."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/investors/groups">
                <Users /> Groups
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/investors/suppression">
                <ShieldOff /> Suppression list
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={exportHref} download>
                <Download /> Export
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/investors/import">
                <Upload /> Import
              </Link>
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <UserPlus /> Add investor
            </Button>
          </>
        }
      />

      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, or organization"
              className="pl-8"
              aria-label="Search investors"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Status" allLabel="All statuses" value={status} onChange={setStatus} options={INVESTOR_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])} />
            <FilterSelect label="Group" allLabel="All groups" value={groupId} onChange={setGroupId} options={groups.map((g) => [g.id, g.name])} />
            <FilterSelect label="Category" allLabel="All categories" value={category} onChange={setCategory} options={categories.map((c) => [c, c])} />
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setQ("");
                  setStatus(ALL);
                  setCategory(ALL);
                  setGroupId(ALL);
                }}
              >
                <X /> Clear
              </Button>
            )}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={groups.length === 0}>
                    <FolderPlus /> Groups
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderPlus /> Add to group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {groups.map((g) => (
                        <DropdownMenuItem key={g.id} onSelect={() => setPendingBulk({ type: "addToGroup", groupId: g.id })}>
                          {g.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderMinus /> Remove from group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {groups.map((g) => (
                        <DropdownMenuItem key={g.id} onSelect={() => setPendingBulk({ type: "removeFromGroup", groupId: g.id })}>
                          {g.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={() => setPendingBulk({ type: "suppress" })}>
                <Ban /> Suppress
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setPendingBulk({ type: "delete" })}>
                <Trash2 /> Delete
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select all on this page" disabled={!items.length} />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell">Organization</TableHead>
                <TableHead className="hidden xl:table-cell">Category</TableHead>
                <TableHead className="hidden xl:table-cell">Groups</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !page
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : items.map((inv) => (
                    <TableRow
                      key={inv.id}
                      data-state={selected.has(inv.id) ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => router.push(`/investors/${inv.id}`)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(inv.id)}
                          aria-label={`Select ${fullName(inv) || inv.email}`}
                          onCheckedChange={(c) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (c) next.add(inv.id);
                              else next.delete(inv.id);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="max-w-56 truncate">{fullName(inv) || <span className="text-muted-foreground">No name</span>}</div>
                        <div className="max-w-56 truncate text-xs font-normal text-muted-foreground md:hidden">{inv.email}</div>
                      </TableCell>
                      <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell">{inv.email}</TableCell>
                      <TableCell className="hidden max-w-48 truncate lg:table-cell">{inv.organization || "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell">{inv.category || "—"}</TableCell>
                      <TableCell className="hidden max-w-56 truncate text-muted-foreground xl:table-cell">
                        {inv.groupIds.map((g) => groupName.get(g)).filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => router.push(`/investors/${inv.id}`)}>View details</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => {
                                setSelected(new Set([inv.id]));
                                setPendingBulk({ type: "suppress" });
                              }}
                              disabled={inv.status !== "active"}
                            >
                              Suppress
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setSelected(new Set([inv.id]));
                                setPendingBulk({ type: "delete" });
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {!loading && items.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title={filtersActive ? "No matching investors" : "No investors yet"}
                description={filtersActive ? "Try a different search or clear the filters." : "Import a spreadsheet or add contacts one at a time."}
                action={
                  !filtersActive && (
                    <Button asChild size="sm">
                      <Link href="/investors/import">
                        <Upload /> Import contacts
                      </Link>
                    </Button>
                  )
                }
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {loading && page ? <Loader2 className="inline size-4 animate-spin" /> : `Page ${cursors.length}`}
            {items.length > 0 && ` · ${items.length} shown`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={cursors.length <= 1 || loading} onClick={() => setCursors((c) => c.slice(0, -1))}>
              <ChevronLeft /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!page?.nextCursor || loading}
              onClick={() => page?.nextCursor && setCursors((c) => [...c, page.nextCursor])}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <InvestorFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        groups={groups}
        categories={categories}
        onSaved={() => {
          load();
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(o) => !o && setPendingBulk(null)}
        title={bulkCopy?.title ?? ""}
        description={bulkCopy?.description ?? ""}
        confirmLabel={bulkCopy?.confirm}
        destructive={pendingBulk?.type === "delete" || pendingBulk?.type === "suppress"}
        onConfirm={runBulk}
      />
    </>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="min-w-32" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function bulkDescription(b: { type: BulkType; groupId?: string }, n: number, groupName: Map<string, string>) {
  const who = `${n} selected contact${n === 1 ? "" : "s"}`;
  switch (b.type) {
    case "addToGroup":
      return { title: "Add to group", description: `Add ${who} to “${groupName.get(b.groupId!)}”.`, confirm: "Add to group" };
    case "removeFromGroup":
      return { title: "Remove from group", description: `Remove ${who} from “${groupName.get(b.groupId!)}”.`, confirm: "Remove" };
    case "suppress":
      return {
        title: "Suppress contacts",
        description: `${who[0].toUpperCase() + who.slice(1)} will be added to the suppression list and will not receive future updates. This can be undone from the suppression list.`,
        confirm: "Suppress",
      };
    case "delete":
      return {
        title: "Delete contacts",
        description: `Permanently delete ${who}. Their past send history is kept for reporting. This cannot be undone.`,
        confirm: "Delete",
      };
  }
}
