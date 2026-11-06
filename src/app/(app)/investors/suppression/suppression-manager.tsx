"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, MoreHorizontal, Plus, ShieldOff, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { Page, SuppressionEntry } from "@/lib/types";

function reasonLabel(raw: string): string {
  switch (raw) {
    case "unsubscribe":
      return "Unsubscribed";
    case "hard_bounce":
    case "bounce":
      return "Hard bounce";
    case "complaint":
      return "Spam complaint";
    case "manual":
      return "Added manually";
    case "provider":
      return "Provider suppression";
    default:
      return raw.replace(/_/g, " ");
  }
}

export function SuppressionManager() {
  const router = useRouter();
  const [items, setItems] = useState<SuppressionEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SuppressionEntry | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (cursor: string | null, append: boolean, ctrl: AbortController) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    try {
      if (append) setLoadingMore(true);
      const page = await api<Page<SuppressionEntry>>(`/api/suppression?${params}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (!ctrl.signal.aborted) toast.error(errorMessage(err));
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => {
      void fetchPage(null, false, ctrl);
    });
    return () => ctrl.abort();
  }, [fetchPage]);

  async function addAddress() {
    const email = addEmail.trim();
    if (!email) {
      toast.error("Enter an email address");
      return;
    }
    setAddSaving(true);
    try {
      await api("/api/suppression", { body: { email } });
      toast.success("Address added to suppression list");
      setAddOpen(false);
      setAddEmail("");
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      await fetchPage(null, false, ctrl);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAddSaving(false);
    }
  }

  async function removeAddress() {
    if (!removeTarget) return;
    try {
      await api("/api/suppression", { method: "DELETE", body: { email: removeTarget.email, confirm: true } });
      toast.success("Address removed from suppression list");
      setItems((prev) => prev.filter((e) => e.email !== removeTarget.email));
      setRemoveTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Suppression list"
        description="Addresses here never receive updates, even if they are in a selected group. Unsubscribes, hard bounces and spam complaints are added automatically."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add address
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
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="hidden sm:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-full max-w-xs" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-28" />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-5 w-36" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="mx-auto size-7 rounded-md" />
                      </TableCell>
                    </TableRow>
                  ))
                : items.map((row) => (
                    <TableRow key={row.email}>
                      <TableCell className="font-mono text-sm">{row.email}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{reasonLabel(row.reason)}</span>
                        <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">{row.source}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground md:hidden">{formatDateTime(row.createdAt)}</div>
                      </TableCell>
                      <TableCell className="hidden max-w-48 truncate text-muted-foreground sm:table-cell">{row.source}</TableCell>
                      <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem variant="destructive" onSelect={() => setRemoveTarget(row)}>
                              <UserMinus /> Remove
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
                icon={ShieldOff}
                title="No suppressed addresses"
                description="When someone unsubscribes or an address hard-bounces, it appears here automatically."
                action={
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus /> Add address
                  </Button>
                }
              />
            </div>
          )}
        </div>

        {nextCursor && items.length > 0 && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => {
                abortRef.current?.abort();
                const ctrl = new AbortController();
                abortRef.current = ctrl;
                void fetchPage(nextCursor, true, ctrl);
              }}
            >
              {loadingMore ? <Loader2 className="animate-spin" /> : null}
              Load more
            </Button>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add address</DialogTitle>
            <DialogDescription>The address will not receive investor updates until it is removed from this list.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="suppression-email">Email</Label>
            <Input
              id="suppression-email"
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
            />
          </div>
          <DialogFooter className="border-0 bg-transparent p-0 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void addAddress()} disabled={addSaving}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title="Remove from suppression list"
        description="Only remove an address if the person has explicitly asked to receive updates again."
        confirmLabel="Remove"
        destructive
        onConfirm={removeAddress}
      />
    </>
  );
}
