import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/page-header";
import { TrackingNote } from "@/components/tracking-note";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { aggregateStats, campaignRates, formatRate, RATE_DEFINITIONS } from "@/lib/analytics";
import { formatDate, formatNumber } from "@/lib/format";
import { listCampaigns } from "@/server/campaigns/repo";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = await listCampaigns({ cursor: sp.cursor ?? null, limit: 25 });
  const totals = aggregateStats(page.items.map((c) => c.stats));
  const totalRates = campaignRates(totals);

  return (
    <>
      <PageHeader title="Analytics" description="Delivery and engagement for every update you have sent." />
      <PageBody>
        {page.items.length === 0 && !sp.cursor ? (
          <EmptyState
            icon={BarChart3}
            title="No updates sent yet"
            description="Once you send an update, delivery, opens, clicks, bounces and unsubscribes appear here."
            action={
              <Button asChild size="sm">
                <Link href="/updates">Go to updates</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Emails accepted" value={formatNumber(totals.accepted)} hint={`Across ${page.items.length} update${page.items.length === 1 ? "" : "s"} below`} />
              <Summary label="Delivery rate" value={formatRate(totalRates.deliveryRate)} hint={`${formatNumber(totals.delivered)} delivered ÷ ${formatNumber(totals.accepted)} accepted`} title={RATE_DEFINITIONS.deliveryRate} />
              <Summary label="Open rate (estimate)" value={formatRate(totalRates.openRate)} hint={`${formatNumber(totals.opened)} ÷ ${formatNumber(totals.delivered)} delivered`} title={RATE_DEFINITIONS.openRate} />
              <Summary label="Click rate" value={formatRate(totalRates.clickRate)} hint={`${formatNumber(totals.clicked)} ÷ ${formatNumber(totals.delivered)} delivered`} title={RATE_DEFINITIONS.clickRate} />
            </div>

            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Update</TableHead>
                    <TableHead className="hidden sm:table-cell">Sent</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Delivered</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Opened</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Clicked</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Bounced</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Unsubscribed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((c) => {
                    const r = campaignRates(c.stats);
                    return (
                      <TableRow key={c.id} className="relative">
                        <TableCell className="max-w-72 truncate font-medium">
                          <Link href={`/analytics/${c.id}`} className="after:absolute after:inset-0">
                            {c.title || c.subject}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(c.approval?.approvedAt)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(c.stats.eligible)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRate(r.deliveryRate)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRate(r.openRate)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRate(r.clickRate)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatNumber(c.stats.bounced)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatNumber(c.stats.unsubscribed)}</TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between">
              {sp.cursor ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/analytics">Newest</Link>
                </Button>
              ) : (
                <span />
              )}
              {page.nextCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/analytics?cursor=${encodeURIComponent(page.nextCursor)}`}>Older updates</Link>
                </Button>
              )}
            </div>
            <TrackingNote />
          </>
        )}
      </PageBody>
    </>
  );
}

function Summary({ label, value, hint, title }: { label: string; value: string; hint: string; title?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4" title={title}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}