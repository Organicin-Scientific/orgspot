import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/session";
import { getSettings } from "@/server/db/settings";
import { getUpdate } from "@/server/db/updates";
import { env } from "@/server/env";
import { UpdateEditor } from "./update-editor";

export const metadata = { title: "Edit update" };

export default async function EditUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, update, settings] = await Promise.all([requireAdminPage(), getUpdate(id), getSettings()]);
  if (!update) notFound();
  return (
    <UpdateEditor
      key={update.id}
      initial={update}
      branding={settings.branding}
      postalAddress={settings.postalAddress}
      footerNote={settings.footerNote}
      adminEmail={session.email}
      liveSending={env().liveSending}
    />
  );
}
