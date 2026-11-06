import { getSettings, sendReadiness } from "@/server/db/settings";
import { env } from "@/server/env";
import { emailProvider } from "@/server/email";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = await getSettings();
  const e = env();
  return (
    <SettingsForm
      initial={settings}
      initialReadiness={sendReadiness(settings)}
      context={{ environment: e.APP_ENV, liveSending: e.liveSending, provider: emailProvider().name, configuredSenderEmail: e.SENDER_EMAIL ?? null }}
    />
  );
}
