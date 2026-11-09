import { fullSendReadiness, getSettings } from "@/server/db/settings";
import { env } from "@/server/env";
import { emailProvider } from "@/server/email";
import { storageProblem } from "@/server/storage";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = await getSettings();
  const e = env();
  const [readiness, storageNotice] = await Promise.all([fullSendReadiness(settings), storageProblem()]);
  return (
    <SettingsForm
      initial={settings}
      initialReadiness={readiness}
      context={{
        environment: e.APP_ENV,
        liveSending: e.liveSending,
        provider: emailProvider().name,
        configuredSenderEmail: e.SENDER_EMAIL ?? null,
        storageNotice,
      }}
    />
  );
}
