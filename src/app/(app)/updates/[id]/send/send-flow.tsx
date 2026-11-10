"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, FileDown, FlaskConical, Loader2, Send, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import type { Campaign, ExcludedRecipient, InvestorGroup, PdfDelivery } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  update: { id: string; title: string; subject: string; pdfDelivery: PdfDelivery };
  groups: InvestorGroup[];
  activeCount: number;
  readiness: { ready: boolean; problems: string[] };
  liveSending: boolean;
  pendingCampaignId: string | null;
}

interface CampaignDetail {
  campaign: Campaign;
  excluded: ExcludedRecipient[];
  delivery: { live: boolean; provider: string };
}

const PDF_LABEL: Record<PdfDelivery, string> = {
  attach: "Attached to each email",
  link: "Personal download link (expires)",
  none: "Not included",
};

const EXCLUSION_LABEL: Record<ExcludedRecipient["reason"], string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Previously bounced",
  suppressed: "Suppressed",
  suppression_list: "On suppression list",
};

export function SendFlow({ update, groups, activeCount, readiness, liveSending, pendingCampaignId }: Props) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState<string | null>(pendingCampaignId);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [allActive, setAllActive] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);

  async function prepare() {
    setPreparing(true);
    setError(null);
    try {
      const res = await api<{ campaignId: string }>(`/api/updates/${update.id}/campaigns`, {
        body: { groupIds: allActive ? [] : selectedGroups, allActive },
      });
      setCampaignId(res.campaignId);
    } catch (err) {
      const problems = err instanceof ApiError ? (err.details as { problems?: string[] } | null)?.problems : undefined;
      setError({ message: errorMessage(err), problems });
    } finally {
      setPreparing(false);
    }
  }

  const selectionCount = allActive ? activeCount : groups.filter((g) => selectedGroups.includes(g.id)).reduce((n, g) => n + g.memberCount, 0);

  return (
    <>
      <PageHeader title="Review and send" description={update.title || "Untitled update"}>
        <Link href={`/updates/${update.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Back to editor
        </Link>
      </PageHeader>
      <PageBody className="max-w-5xl">
        {!liveSending && (
          <Alert>
            <FlaskConical />
            <AlertTitle>Sandbox mode</AlertTitle>
            <AlertDescription>
              This environment never delivers email. Confirming will simulate the send so you can check the workflow and analytics.
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{error.message}</AlertTitle>
            {error.problems && error.problems.length > 1 && (
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {error.problems.slice(1).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </AlertDescription>
            )}
          </Alert>
        )}

        {!campaignId ? (
          <Card>
            <CardHeader>
              <CardTitle>1. Choose recipients</CardTitle>
              <CardDescription>
                Unsubscribed, bounced and suppressed contacts are always excluded. Anyone in more than one group receives a single copy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!readiness.ready && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Finish setup before sending</AlertTitle>
                  <AlertDescription>
                    {readiness.problems[0]}{" "}
                    <Link href="/settings" className="underline">
                      Open settings
                    </Link>
                  </AlertDescription>
                </Alert>
              )}
              <label className={cn("flex items-center gap-3 rounded-lg border p-3", allActive && "border-foreground/30 bg-muted/40")}>
                <Checkbox checked={allActive} onCheckedChange={(c) => setAllActive(!!c)} />
                <div className="flex-1">
                  <div className="text-sm font-medium">All active investors</div>
                  <div className="text-xs text-muted-foreground">Everyone in the directory who can receive updates</div>
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">{formatNumber(activeCount)}</span>
              </label>
              {groups.length > 0 && (
                <div className={cn("space-y-2", allActive && "pointer-events-none opacity-50")}>
                  <Label className="text-xs text-muted-foreground">Or choose groups</Label>
                  <div className="divide-y rounded-lg border">
                    {groups.map((g) => (
                      <label key={g.id} className="flex items-center gap-3 px-3 py-2.5">
                        <Checkbox
                          checked={selectedGroups.includes(g.id)}
                          onCheckedChange={(c) => setSelectedGroups((s) => (c ? [...s, g.id] : s.filter((x) => x !== g.id)))}
                          disabled={allActive}
                        />
                        <span className="flex-1 text-sm">{g.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(g.memberCount)} contacts</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Preparing creates a frozen copy of the email and recipient list for you to review. Nothing is sent yet.
                </p>
                <Button onClick={prepare} disabled={preparing || !readiness.ready || (!allActive && selectedGroups.length === 0)}>
                  {preparing ? <Loader2 className="animate-spin" /> : <Users />}
                  {preparing ? "Preparing…" : `Prepare review${selectionCount ? ` (up to ${formatNumber(selectionCount)})` : ""}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Review
            campaignId={campaignId}
            onDiscard={() => setCampaignId(null)}
            onApproved={(id) => router.push(`/analytics/${id}`)}
          />
        )}
      </PageBody>
    </>
  );
}

function Review({
  campaignId,
  onDiscard,
  onApproved,
}: {
  campaignId: string;
  onDiscard: () => void;
  onApproved: (id: string) => void;
}) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<CampaignDetail>(`/api/campaigns/${campaignId}`), api<{ html: string }>(`/api/campaigns/${campaignId}/html`)])
      .then(([d, h]) => {
        if (cancelled) return;
        if (d.campaign.status !== "pending_approval") {
          setError("This review is no longer valid (the update was edited or another review replaced it). Prepare a new review.");
          return;
        }
        setDetail(d);
        setHtml(h.html);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function discard() {
    setDiscarding(true);
    try {
      await api(`/api/campaigns/${campaignId}/cancel`, { body: {} });
      onDiscard();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDiscarding(false);
    }
  }

  async function approve() {
    if (!detail) return;
    setApproving(true);
    try {
      await api(`/api/campaigns/${campaignId}/approve`, { body: { snapshotHash: detail.campaign.snapshotHash, confirm: true } });
      toast.success(detail.delivery.live ? "Sending has started" : "Sandbox send started");
      onApproved(campaignId);
    } catch (err) {
      toast.error(errorMessage(err));
      setApproving(false);
      setConfirmOpen(false);
    }
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{error}</AlertTitle>
        <AlertDescription>
          <Button variant="outline" size="sm" className="mt-2" onClick={onDiscard}>
            Choose recipients again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!detail) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-[540px]" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const c = detail.campaign;
  const excludedByReason = detail.excluded.reduce<Record<string, number>>((acc, e) => {
    acc[e.reason] = (acc[e.reason] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="text-base">2. Review the email</CardTitle>
          <CardDescription>Exactly what each investor will receive. Personal links are shown as samples.</CardDescription>
        </CardHeader>
        <CardContent className="bg-muted/40 p-4">
          <div className="mx-auto max-w-[680px] overflow-hidden rounded-md border bg-white shadow-sm">
            {html && <iframe title="Email to be sent" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="block h-[620px] w-full" />}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Item label="Subject">{c.subject}</Item>
              <Item label="From">
                {c.sender.fromName} &lt;{c.sender.fromEmail}&gt;
              </Item>
              {c.sender.replyTo && <Item label="Replies go to">{c.sender.replyTo}</Item>}
              <Item label="PDF">
                {PDF_LABEL[c.pdfDelivery]}
                {c.pdfDelivery !== "none" && (
                  <a href={`/api/campaigns/${c.id}/pdf`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs underline">
                    <FileDown className="size-3" /> Open the PDF
                  </a>
                )}
              </Item>
              <Item label="Audience">{c.audience.allActive ? "All active investors" : c.audience.groupNames.join(", ")}</Item>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recipients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span>Will receive this update</span>
              <span className="text-2xl font-semibold tabular-nums">{formatNumber(c.stats.eligible)}</span>
            </div>
            {c.stats.excluded > 0 && (
              <div className="space-y-1 rounded-md bg-muted/50 p-3">
                <div className="flex justify-between font-medium">
                  <span>Excluded</span>
                  <span className="tabular-nums">{formatNumber(c.stats.excluded)}</span>
                </div>
                {Object.entries(excludedByReason).map(([reason, n]) => (
                  <div key={reason} className="flex justify-between text-xs text-muted-foreground">
                    <span>{EXCLUSION_LABEL[reason as ExcludedRecipient["reason"]] ?? reason}</span>
                    <span className="tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-foreground/20">
          <CardHeader>
            <CardTitle className="text-base">3. Confirm</CardTitle>
            <CardDescription>Sending cannot be undone. Each investor receives one email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full" size="lg" onClick={() => setConfirmOpen(true)}>
              <Send /> Confirm and Send
            </Button>
            <Button variant="ghost" className="w-full" onClick={discard} disabled={discarding}>
              {discarding && <Loader2 className="animate-spin" />}
              Discard this review
            </Button>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (approving) return;
          setConfirmOpen(o);
          if (!o) setAcknowledged(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send to {formatNumber(c.stats.eligible)} investor{c.stats.eligible === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  “{c.subject}” will be sent from {c.sender.fromEmail}.{" "}
                  {detail.delivery.live ? "Emails will be delivered to real inboxes." : "Sandbox mode: nothing will be delivered."}
                </p>
                <label className="flex items-start gap-2 text-foreground">
                  <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(!!v)} className="mt-0.5" />
                  <span>I have reviewed the content and the recipient list.</span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!acknowledged || approving}
              onClick={(e) => {
                e.preventDefault();
                void approve();
              }}
            >
              {approving ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Confirm and Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
