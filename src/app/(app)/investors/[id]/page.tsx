import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageBody, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { recipientHistory } from "@/server/campaigns/repo";
import { distinctCategories, getInvestor, investorHistory } from "@/server/db/investors";
import { listGroups } from "@/server/db/groups";
import { getSuppression } from "@/server/db/suppression";
import { InvestorActions } from "./investor-actions";

export const metadata = { title: "Investor" };

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  organization: "Organization",
  category: "Category",
  notes: "Notes",
  groups: "Groups",
  groupIds: "Groups",
  status: "Status",
  created: "Created",
};

export default async function InvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const investor = await getInvestor(id);
  if (!investor) notFound();
  const [groups, categories, changes, sends, suppression] = await Promise.all([
    listGroups(),
    distinctCategories(),
    investorHistory(id),
    recipientHistory(id),
    getSuppression(investor.email),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const name = fullName(investor) || investor.email;

  return (
    <>
      <PageHeader
        title={name}
        description={investor.organization || undefined}
        actions={<InvestorActions investor={investor} groups={groups} categories={categories} suppressed={!!suppression} />}
      >
        <Link href="/investors" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Investors
        </Link>
      </PageHeader>
      <PageBody className="grid gap-6 space-y-0 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Status">
                <StatusBadge status={investor.status} />
                {suppression && <span className="ml-2 text-xs text-muted-foreground">on suppression list ({suppression.reason.replace(/_/g, " ")})</span>}
              </Row>
              <Row label="Email">{investor.email}</Row>
              <Row label="Organization">{investor.organization || "—"}</Row>
              <Row label="Category">{investor.category || "—"}</Row>
              <Row label="Groups">
                {investor.groupIds.length ? investor.groupIds.map((g) => groupName.get(g) ?? "Removed group").join(", ") : "—"}
              </Row>
              <Row label="Added">{formatDate(investor.createdAt)}</Row>
              {investor.notes && (
                <Row label="Notes">
                  <p className="whitespace-pre-wrap">{investor.notes}</p>
                </Row>
              )}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Updates received</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {sends.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground">This contact has not been sent any updates yet.</p>
              ) : (
                <ul className="divide-y">
                  {sends.map(({ recipient, campaign }) => (
                    <li key={recipient.campaignId}>
                      <Link href={`/analytics/${recipient.campaignId}`} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{campaign?.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(campaign?.approval?.approvedAt)}
                            {recipient.openedAt && " · Opened"}
                            {recipient.clickedAt && " · Clicked"}
                            {recipient.unsubscribedAt && " · Unsubscribed"}
                          </div>
                        </div>
                        <StatusBadge status={recipient.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change history</CardTitle>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes recorded.</p>
              ) : (
                <ol className="space-y-4">
                  {changes.map((h) => (
                    <li key={h.id} className="text-sm">
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(h.at)} · {h.actor}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {Object.entries(h.changes).map(([field, change]) => (
                          <li key={field}>
                            <span className="font-medium">{FIELD_LABELS[field] ?? field}</span>{" "}
                            {field === "created" ? (
                              <span className="text-muted-foreground">{change.to === "import" ? "from a spreadsheet import" : "manually"}</span>
                            ) : (
                              <span className="text-muted-foreground">
                                {display(change.from, groupName)} → {display(change.to, groupName)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function display(v: unknown, groups: Map<string, string>): string {
  if (Array.isArray(v)) return v.length ? v.map((g) => groups.get(String(g)) ?? "Removed group").join(", ") : "none";
  if (v === null || v === undefined || v === "") return "empty";
  return String(v);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words">{children}</dd>
    </div>
  );
}
