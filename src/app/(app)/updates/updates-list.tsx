"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, ChevronDown, Copy, FileText, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate, relativeTime } from "@/lib/format";
import type { Page, UpdateDoc, UpdateSummary } from "@/lib/types";

const TABS = [
  ["all", "All"],
  ["draft", "Drafts"],
  ["ready", "Awaiting confirmation"],
  ["sent", "Sent"],
] as const;

export function UpdatesList({ initialStatus }: { initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(TABS.some(([k]) => k === initialStatus) ? initialStatus : "all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [data, setData] = useState<{ key: string; items: UpdateSummary[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UpdateSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useCallback(
    (after: string | null) => {
      const p = new URLSearchParams();
      if (status !== "all") p.set("status", status);
      if (debouncedQ) p.set("q", debouncedQ);
      if (after) p.set("cursor", after);
      return api<Page<UpdateSummary>>(`/api/updates?${p}`);
    },
    [status, debouncedQ],
  );

  const key = `${status}|${debouncedQ}`;
  const current = data?.key === key ? data : null;
  const items = current?.items ?? null;
  const cursor = current?.cursor ?? null;

  useEffect(() => {
    let cancelled = false;
    query(null)
      .then((page) => {
        if (!cancelled) setData({ key, items: page.items, cursor: page.nextCursor });
      })
      .catch((err) => !cancelled && toast.error(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [query, key]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await query(cursor);
      setData((d) => (d && d.key === key ? { key, items: [...d.items, ...page.items], cursor: page.nextCursor } : d));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function create(blank: boolean) {
    setCreating(true);
    try {
      const u = await api<UpdateDoc>("/api/updates", { body: { blank } });
      router.push(`/updates/${u.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setCreating(false);
    }
  }

  async function duplicate(u: UpdateSummary) {
    try {
      const copy = await api<UpdateDoc>(`/api/updates/${u.id}/duplicate`, { body: {} });
      router.push(`/updates/${copy.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api(`/api/updates/${deleting.id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== deleting.id) } : d));
      toast.success("Draft deleted");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const href = (u: UpdateSummary) => (u.sentCampaignId ? `/analytics/${u.sentCampaignId}` : `/updates/${u.id}`);

  return (
    <>
      <PageHeader
        title="Updates"
        description="Drafts and the archive of every update you have sent."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={creating}>
                {creating ? <Loader2 className="animate-spin" /> : <Plus />} New update <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => create(false)}>
                <div>
                  <div className="font-medium">From the update template</div>
                  <div className="text-xs text-muted-foreground">Quote, what we do, key metrics, highlights and lowlights</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => create(true)}>
                <div>
                  <div className="font-medium">Blank document</div>
                  <div className="text-xs text-muted-foreground">Start from an empty page</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList>
              {TABS.map(([k, label]) => (
                <TabsTrigger key={k} value={k}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or subject" className="pl-8" aria-label="Search updates" />
          </div>
        </div>

        {items !== null && items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={debouncedQ ? "No matching updates" : status === "all" ? "No updates yet" : "Nothing here"}
            description={debouncedQ ? "Try a different search." : "Create your first update from the template. It includes the usual sections so you only fill in this quarter’s details."}
            action={
              !debouncedQ && (
                <Button size="sm" onClick={() => create(false)} disabled={creating}>
                  <Plus /> New update
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Last activity</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items === null
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((u) => (
                      <TableRow key={u.id} className="cursor-pointer" onClick={() => router.push(href(u))}>
                        <TableCell className="max-w-72 truncate font-medium">{u.title || "Untitled update"}</TableCell>
                        <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">{u.subject || "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={u.status} />
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {u.sentAt ? `Sent ${formatDate(u.sentAt)}` : `Edited ${relativeTime(u.updatedAt)}`}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label="Update actions">
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => router.push(`/updates/${u.id}`)}>
                                <Pencil /> {u.status === "draft" || u.status === "ready" ? "Edit" : "View content"}
                              </DropdownMenuItem>
                              {u.sentCampaignId && (
                                <DropdownMenuItem onSelect={() => router.push(`/analytics/${u.sentCampaignId}`)}>
                                  <BarChart3 /> Delivery and engagement
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => duplicate(u)}>
                                <Copy /> Duplicate
                              </DropdownMenuItem>
                              {(u.status === "draft" || u.status === "ready") && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(u)}>
                                    <Trash2 /> Delete draft
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
        )}
        {cursor && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={more} disabled={loadingMore}>
              {loadingMore && <Loader2 className="animate-spin" />} Load more
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Sent updates are kept permanently as an archive. <Link href="/analytics" className="underline">See analytics</Link> for delivery details.
        </p>
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete draft?"
        description={`“${deleting?.title || "Untitled update"}” and its version history will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
