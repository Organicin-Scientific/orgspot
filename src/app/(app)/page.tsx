import Link from "next/link";
import { AlertTriangle, ArrowRight, FileText, Users } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { campaignRates, formatRate } from "@/lib/analytics";
import { formatDate, formatNumber, relativeTime } from "@/lib/format";
import { recentSentCampaigns } from "@/server/campaigns/repo";
import { recentActivity } from "@/server/db/activity";
import { countInvestors } from "@/server/db/investors";
import { fullSendReadiness, getSettings } from "@/server/db/settings";
import { countUpdates, listUpdates } from "@/server/db/updates";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [active, total, drafts, sentCount, recent, campaigns, activity, settings] = await Promise.all([
    countInvestors("active"),
    countInvestors(),
    countUpdates("draft"),
    countUpdates("sent"),
    listUpdates({ limit: 6 }),
    recentSentCampaigns(1),
    recentActivity(10),
    getSettings(),
  ]);
  const last = campaigns[0] ?? null;
  const lastRates = last ? campaignRates(last.stats) : null;
  const readiness = await fullSendReadiness(settings);

  return (
    <>
      <PageHeader title="Dashboard" description="Your investor communications at a glance." />
      <PageBody>
        {!readiness.ready && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">Finish setup before sending</p>
                <p className="text-muted-foreground">{readiness.problems[0]}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings">Open settings</Link>
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Active investors" value={formatNumber(active)} hint={`${formatNumber(total)} contacts in total`} href="/investors" />
          <Metric label="Drafts" value={formatNumber(drafts)} hint="Updates in progress" href="/updates?status=draft" />
          <Metric label="Updates sent" value={formatNumber(sentCount)} hint="All time" href="/analytics" />
          <Metric
            label="Last update · open rate"
            value={lastRates ? formatRate(lastRates.openRate) : "—"}
            hint={
              last
                ? `${formatNumber(last.stats.opened)} of ${formatNumber(last.stats.delivered)} delivered · estimate`
                : "No updates sent yet"
            }
            href={last ? `/analytics/${last.id}` : "/analytics"}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent updates</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/updates">
                  View all <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {recent.items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
                  <FileText className="size-5" aria-hidden />
                  No updates yet. Use “New Update” to start your first one.
                </div>
              ) : (
                <ul className="divide-y">
                  {recent.items.map((u) => (
                    <li key={u.id}>
                      <Link
                        href={u.sentCampaignId ? `/analytics/${u.sentCampaignId}` : `/updates/${u.id}`}
                        className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{u.title || "Untitled update"}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {u.sentAt ? `Sent ${formatDate(u.sentAt)}` : `Edited ${relativeTime(u.updatedAt)} by ${u.updatedBy}`}
                          </div>
                        </div>
                        <StatusBadge status={u.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ol className="space-y-4">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                      <div className="min-w-0">
                        <p className="leading-snug">{a.summary}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.actorEmail === "recipient" ? "Recipient" : a.actorEmail} · {relativeTime(a.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {total === 0 && (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <Users className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
                <div className="text-sm">
                  <p className="font-medium">Add your investors</p>
                  <p className="text-muted-foreground">Import a CSV or Excel export, or add contacts one at a time.</p>
                </div>
              </div>
              <Button asChild>
                <Link href="/investors/import">Import contacts</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function Metric({ label, value, hint, href }: { label: string; value: string; hint: string; href: string }) {
  return (
    <Link href={href} className="group rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>
    </Link>
  );
}
