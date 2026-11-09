import { getSettings } from "@/server/db/settings";
import { domainCheckProvider } from "@/server/email";
import { emailDomain } from "@/lib/email-address";
import { ok, withAdmin } from "@/server/http/handler";

/** Live SPF/DKIM/tracking status of the sending domain, read from the provider. */
export const GET = withAdmin(async () => {
  const settings = await getSettings();
  const domain = emailDomain(settings.sender.fromEmail);
  if (!domain) return ok({ configured: false, status: null });
  const provider = domainCheckProvider();
  const status = await provider.domainStatus(domain);
  return ok({ configured: true, provider: provider.name, status });
});
