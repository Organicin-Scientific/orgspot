import Link from "next/link";
import { AlertTriangle, Users } from "lucide-react";
import { NewUpdateButton } from "@/components/new-update-button";
import { Button } from "@/components/ui/button";
import { deliverabilityHealth, firstNameFromEmail, pickUpNext, sendsByMonth } from "@/lib/dashboard";
import { requireAdminPage } from "@/server/auth/session";
import { recentSentCampaigns } from "@/server/campaigns/repo";
import { recentActivity } from "@/server/db/activity";
import { countInvestors } from "@/server/db/investors";
import { fullSendReadiness, getSettings } from "@/server/db/settings";
import { listUpdates } from "@/server/db/updates";
import { DashboardGreeting } from "./dashboard-greeting";
import { ActivityPanel, CadencePanel, HealthPanel, LastSendPanel, RecentPanel, UpNextPanel } from "./dashboard-panels";

export const metadata = { title: "Dashboard" };

const HEALTH_WINDOW = 5;
const TREND_WINDOW = 6;

export default async function DashboardPage() {
  const session = await requireAdminPage();
  const [active, total, unsubscribed, bounced, updates, campaigns, activity, settings] = await Promise.all([
    countInvestors("active"),
    countInvestors(),
    countInvestors("unsubscribed"),
    countInvestors("bounced"),
    listUpdates({ limit: 12 }),
    recentSentCampaigns(24),
    recentActivity(8),
    getSettings(),
  ]);
  const readiness = await fullSendReadiness(settings);

  const upNext = pickUpNext(updates.items);
  const upNextCampaign = upNext?.sentCampaignId ? (campaigns.find((c) => c.id === upNext.sentCampaignId) ?? null) : null;
  const completed = campaigns.filter((c) => ["sent", "partially_failed", "failed"].includes(c.status));
  const last = completed[0] ?? null;
  const lastSentAt = last?.approval?.approvedAt ?? null;
  const trend = completed.slice(0, TREND_WINDOW).reverse();
  const health = deliverabilityHealth(completed.slice(0, HEALTH_WINDOW).map((c) => c.stats));
  const months = sendsByMonth(campaigns);
  const recent = updates.items.filter((u) => u.id !== upNext?.id).slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <header className="dash-enter flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" style={{ "--i": 0 } as React.CSSProperties}>
        <DashboardGreeting name={firstNameFromEmail(session.email)} />
        <div className="flex gap-2">
          <Button asChild variant="outline" className="pressable">
            <Link href="/investors">
              <Users />
              Investors
            </Link>
          </Button>
          <NewUpdateButton />
        </div>
      </header>

      {!readiness.ready && (
        <div
          className="dash-enter flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ "--i": 1 } as React.CSSProperties}
        >
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

      <div className="grid gap-4 lg:grid-cols-3">
        <UpNextPanel update={upNext} campaign={upNextCampaign} lastSentAt={lastSentAt} index={1} />
        <CadencePanel
          lastSentAt={lastSentAt}
          months={months}
          active={active}
          total={total}
          unsubscribed={unsubscribed}
          bounced={bounced}
          index={2}
        />
        <LastSendPanel campaign={last} trend={trend} index={3} />
        <HealthPanel health={health} sampled={Math.min(completed.length, HEALTH_WINDOW)} index={4} />
        <RecentPanel updates={recent} index={5} />
        <ActivityPanel activity={activity} index={6} />
      </div>
    </div>
  );
}
