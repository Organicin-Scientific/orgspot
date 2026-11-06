/**
 * Email normalisation is the deduplication key for investors and the suppression list,
 * so it must be deterministic and conservative: trim + lowercase only. Provider-specific
 * rules (e.g. Gmail dot-stripping) are deliberately not applied because they would merge
 * genuinely different mailboxes on other providers.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

// Pragmatic RFC 5322 subset: one @, no whitespace, a dotted domain with a 2+ char TLD.
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

export function isValidEmail(input: string): boolean {
  const v = input.trim();
  if (v.length < 6 || v.length > 254) return false;
  if (!EMAIL_RE.test(v)) return false;
  const [local] = v.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return true;
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@")[1] ?? "";
}
