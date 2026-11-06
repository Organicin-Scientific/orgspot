import { distinctCategories } from "@/server/db/investors";
import { listGroups } from "@/server/db/groups";
import { InvestorDirectory } from "./investor-directory";

export const metadata = { title: "Investors" };

export default async function InvestorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [groups, categories, sp] = await Promise.all([listGroups(), distinctCategories(), searchParams]);
  return <InvestorDirectory groups={groups} categories={categories} initialGroupId={sp.group ?? null} />;
}
