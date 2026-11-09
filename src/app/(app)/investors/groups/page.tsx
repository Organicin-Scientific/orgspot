import { listGroups } from "@/server/db/groups";
import { GroupsManager } from "./groups-manager";

export const metadata = { title: "Groups" };

export default async function GroupsPage() {
  const groups = await listGroups();
  const syncKey = groups.map((g) => `${g.id}:${g.updatedAt}:${g.memberCount}`).join("|");
  return <GroupsManager key={syncKey} initialGroups={groups} />;
}
