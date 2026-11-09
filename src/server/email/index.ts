import "server-only";
import { env } from "../env";
import type { EmailProvider } from "./provider";
import { ResendProvider } from "./resend-provider";
import { SandboxProvider } from "./sandbox-provider";

let override: EmailProvider | null = null;
let cached: EmailProvider | null = null;

/**
 * Real email is only possible in production with EMAIL_SENDING_ENABLED=true.
 * Local development, CI and Vercel preview deployments always use the sandbox.
 */
export function emailProvider(): EmailProvider {
  if (override) return override;
  if (cached) return cached;
  const e = env();
  cached = e.liveSending ? new ResendProvider(e.RESEND_API_KEY!) : new SandboxProvider();
  return cached;
}

/** Read-only provider for domain verification checks (works in any environment with an API key). */
export function domainCheckProvider(): EmailProvider {
  const e = env();
  return e.RESEND_API_KEY ? new ResendProvider(e.RESEND_API_KEY) : new SandboxProvider();
}

/** Test hook. */
export function setEmailProviderForTests(p: EmailProvider | null) {
  override = p;
  cached = null;
}
