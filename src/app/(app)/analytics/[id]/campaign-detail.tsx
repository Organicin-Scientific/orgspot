"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileDown, FlaskConical, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TrackingNote } from "@/components/tracking-note";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api-client";
import { campaignRates, formatRate, RATE_DEFINITIONS, type CampaignRates } from "@/lib/analytics";
import { formatDateTime, formatNumber, fullName } from "@/lib/format";
import { RECIPIENT_STATUSES, type Campaign, type CampaignRecipient, type EmailEvent, type ExcludedRecipient, type Page } from "@/lib/types";

const ACTIVE = new Set(["queued", "sending"]);
const ALL = "__all";

const EVENT_LABEL: Record<string, string> = {
  sent: "Accepted by provider",
  delivered: "Delivered",
  delivery_delayed: "Delivery delayed",
  bounced: "Bounced",
  complained: "Marked as spam",
  opened: "Opened",
  clicked: "Clicked a link",
  failed: "Failed",
  suppressed: "Suppressed by provider",
};

interface Detail {
  campaign: Campaign;
  rates: CampaignRates;
  excluded: ExcludedRecipient[];
  delivery: { live: boolean; provider: string };
}

export function CampaignDetail({ initial }: { initial: Campaign }) {
  const [detail, setDetail] = useState<Detail>({ campaign: initial, rates: campaignRates(initial.stats), excluded: [], delivery: { live: true, provider: "" } });
  const [emailOpen, setEmailOpen] = useState(false);
  const c = detail.campaign;
  const s = c.stats;
  const inProgress = ACTIVE.has(c.status);

  const [tick, setTick] = useState(0);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`/api/campaigns/${initial.id}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && toast.error(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [initial.id, tick]);

  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [inProgress]);

  async function resumeSending() {
    setResuming(true);
    try {
      await api("/api/internal/worker", { method: "POST", body: {} });
      setTick((n) => n + 1);
      toast.success("Send queue processed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResuming(false);
    }
  }

  const processed = s.accepted + s.failed + s.skipped;
  const progress = s.eligible ? Math.round((processed / s.eligible) * 100) : 0;
  const r = detail.rates;

  return (
    <>
      <PageHeader
        title={c.title || c.subject}
        description={`“${c.subject}” · ${c.approval ? `approved ${formatDateTime(c.approval.approvedAt)} by ${c.approval.approvedBy}` : "not approved"}`}
        actions={
          <>
            <StatusBadge status={c.status} />
            <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
              <Mail /> View email
            </Button>
            {c.pdfDelivery !== "none" && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/campaigns/${c.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileDown /> PDF
                </a>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/updates/${c.updateId}`}>
                <ExternalLink /> Source update
              </Link>
            </Button>
          </>
        }
      >
        <Link href="/analytics" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Analytics
        </Link>
      </PageHeader>
      <PageBody>
        {!detail.delivery.live && detail.delivery.provider && (
          <Alert>
            <FlaskConical />
            <AlertDescription>Sandbox environment: these results are simulated and no email was delivered.</AlertDescription>
          </Alert>
        )}
        {inProgress && (
          <Card>
            <CardContent className="space-y-2 py-4">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{c.status === "queued" ? "Queued — starting shortly" : "Sending…"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(processed)} of {formatNumber(s.eligible)}
                </span>
              </div>
              <Progress value={progress} aria-label="Send progress" />
              <p className="text-xs text-muted-foreground">
                Sending starts when you approve. Large lists may need another pass—use Continue sending or wait for the daily worker if
                progress stalls.
              </p>
              <Button variant="outline" size="sm" onClick={resumeSending} disabled={resuming}>
                {resuming ? <Loader2 className="animate-spin" /> : null}
                Continue sending
              </Button>
            </CardContent>
          </Card>
        )}
        {c.status === "partially_failed" && (
          <Alert variant="destructive">
            <AlertTitle>Some messages could not be sent</AlertTitle>
            <AlertDescription>Filter recipients by “Failed” or “Needs review” below to see who did not receive the update.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Rate label="Delivered" rate={r.deliveryRate} num={s.delivered} den={s.accepted} denLabel="accepted" def={RATE_DEFINITIONS.deliveryRate} />
          <Rate label="Opened (estimate)" rate={r.openRate} num={s.opened} den={s.delivered} denLabel="delivered" def={RATE_DEFINITIONS.openRate} />
          <Rate label="Clicked" rate={r.clickRate} num={s.clicked} den={s.delivered} denLabel="delivered" def={RATE_DEFINITIONS.clickRate} />
          <Rate label="Bounced" rate={r.bounceRate} num={s.bounced} den={s.accepted} denLabel="accepted" def={RATE_DEFINITIONS.bounceRate} />
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Count label="Selected" value={s.selected} />
          <Count label="Excluded" value={s.excluded} />
          <Count label="Accepted" value={s.accepted} />
          <Count label="Failed" value={s.failed} />
          <Count label="Spam complaints" value={s.complained} />
          <Count label="Unsubscribed" value={s.unsubscribed} />
        </div>

        <Recipients campaignId={c.id} refreshKey={processed + s.delivered + s.opened} />

        {detail.excluded.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Excluded at send time ({formatNumber(detail.excluded.length)})</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y text-sm">
                {detail.excluded.map((e) => (
                  <li key={e.investorId} className="flex justify-between gap-4 px-6 py-2">
                    <span className="truncate">{e.name || e.email}</span>
                    <span className="text-muted-foreground">{e.reason.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <TrackingNote />
      </PageBody>
      <EmailDialog open={emailOpen} onOpenChange={setEmailOpen} campaignId={c.id} subject={c.subject} />
    </>
  );
}

function Rate({ label, rate, num, den, denLabel, def }: { label: string; rate: number | null; num: number; den: number; denLabel: string; def: string }) {
  return (
    <div className="rounded-xl border bg-card p-4" title={def}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{formatRate(rate)}</div>
      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
        {formatNumber(num)} of {formatNumber(den)} {denLabel}
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{formatNumber(value)}</div>
    </div>
  );
}

function Recipients({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const [status, setStatus] = useState(ALL);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<Page<CampaignRecipient> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const changeStatus = (v: string) => {
    setStatus(v);
    setCursors([null]);
  };

  useEffect(() => {
    const p = new URLSearchParams();
    if (status !== ALL) p.set("status", status);
    const cursor = cursors[cursors.length - 1];
    if (cursor) p.set("cursor", cursor);
    let cancelled = false;
    api<Page<CampaignRecipient>>(`/api/campaigns/${campaignId}/recipients?${p}`)
      .then((res) => !cancelled && setPage(res))
      .catch((err) => !cancelled && toast.error(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [campaignId, status, cursors, refreshKey]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">Recipients</CardTitle>
        <Select value={status} onValueChange={changeStatus}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter recipients by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All recipients</SelectItem>
            {RECIPIENT_STATUSES.map((st) => (
              <SelectItem key={st} value={st}>
                {st.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Recipient</TableHead>
              <TableHead className="hidden md:table-cell">Organization</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Engagement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page === null ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : page.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No recipients with this status.
                </TableCell>
              </TableRow>
            ) : (
              page.items.flatMap((rc) => {
                const open = expanded === rc.id;
                const rows = [
                  <TableRow key={rc.id} className="cursor-pointer" onClick={() => setExpanded(open ? null : rc.id)} aria-expanded={open}>
                    <TableCell>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                    <TableCell>
                      <div className="max-w-60 truncate font-medium">{fullName(rc) || rc.email}</div>
                      <div className="max-w-60 truncate text-xs text-muted-foreground">{rc.email}</div>
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate md:table-cell">{rc.organization || "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={rc.status} />
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {[rc.openedAt && "Opened", rc.clickedAt && "Clicked", rc.unsubscribedAt && "Unsubscribed"].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>,
                ];
                if (open) {
                  rows.push(
                    <TableRow key={`${rc.id}-events`} className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={4}>
                        <Timeline campaignId={campaignId} recipient={rc} />
                      </TableCell>
                    </TableRow>,
                  );
                }
                return rows;
              })
            )}
          </TableBody>
        </Table>
        <div className="flex justify-end gap-2 px-6 pt-4">
          <Button variant="outline" size="sm" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
            <ChevronLeft /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!page?.nextCursor} onClick={() => page?.nextCursor && setCursors((c) => [...c, page.nextCursor])}>
            Next <ChevronRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Timeline({ campaignId, recipient }: { campaignId: string; recipient: CampaignRecipient }) {
  const [events, setEvents] = useState<EmailEvent[] | null>(null);
  useEffect(() => {
    api<EmailEvent[]>(`/api/campaigns/${campaignId}/events?recipientId=${encodeURIComponent(recipient.id)}`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [campaignId, recipient.id]);

  return (
    <div className="space-y-2 py-1 text-sm">
      <div className="text-xs text-muted-foreground">
        Queued {formatDateTime(recipient.queuedAt)} · {recipient.attempts} send attempt{recipient.attempts === 1 ? "" : "s"}
        {recipient.lastError && <span className="text-destructive"> · {recipient.lastError}</span>}
      </div>
      {events === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No provider events recorded yet.</p>
      ) : (
        <ol className="space-y-1">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 text-xs">
              <span className="w-40 shrink-0 tabular-nums text-muted-foreground">{formatDateTime(e.occurredAt)}</span>
              <span>
                {EVENT_LABEL[e.type] ?? e.type}
                {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EmailDialog({ open, onOpenChange, campaignId, subject }: { open: boolean; onOpenChange: (o: boolean) => void; campaignId: string; subject: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!open || html) return;
    api<{ html: string }>(`/api/campaigns/${campaignId}/html`)
      .then((r) => setHtml(r.html))
      .catch((err) => toast.error(errorMessage(err)));
  }, [open, html, campaignId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90svh] max-w-[min(820px,96vw)] flex-col gap-0 p-0 sm:max-w-[min(820px,96vw)]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="truncate pr-8">{subject}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-muted/40 p-4">
          {html ? (
            <iframe title="Sent email" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-full w-full rounded-md border bg-white" />
          ) : (
            <Loader2 className="mx-auto mt-20 size-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
