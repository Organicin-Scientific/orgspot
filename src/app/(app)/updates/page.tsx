import { UpdatesList } from "./updates-list";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <UpdatesList initialStatus={sp.status ?? "all"} />;
}
