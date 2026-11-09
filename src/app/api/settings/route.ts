import { audit } from "@/server/audit";
import { getSettings, saveSettings, sendReadiness } from "@/server/db/settings";
import { env } from "@/server/env";
import { emailProvider } from "@/server/email";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { settingsInput } from "@/server/http/schemas";

function context() {
  const e = env();
  return {
    environment: e.APP_ENV,
    liveSending: e.liveSending,
    provider: emailProvider().name,
    configuredSenderEmail: e.SENDER_EMAIL ?? null,
  };
}

export const GET = withAdmin(async () => {
  const settings = await getSettings();
  return ok({ settings, readiness: sendReadiness(settings), context: context() });
});

export const PUT = withAdmin(async ({ req, session }) => {
  const input = await readJson(req, settingsInput);
  await saveSettings(input, session.email);
  await audit({ actorEmail: session.email, action: "settings.update", resourceType: "settings", resourceId: "app", summary: "Updated branding and sender settings" });
  const settings = await getSettings();
  return ok({ settings, readiness: sendReadiness(settings), context: context() });
});
