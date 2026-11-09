import { AppShell } from "@/components/app-shell";
import { requireAdminPage } from "@/server/auth/session";
import { env } from "@/server/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPage();
  const e = env();
  return (
    <AppShell email={session.email} liveSending={e.liveSending} environment={e.APP_ENV}>
      {children}
    </AppShell>
  );
}
