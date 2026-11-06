import { listGroups } from "@/server/db/groups";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import investors" };

export default async function ImportPage() {
  return <ImportWizard groups={await listGroups()} />;
}
