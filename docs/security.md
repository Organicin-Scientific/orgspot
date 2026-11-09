# Security

This document describes the **threat model** the code is built around and **controls that are implemented**. It is not an external audit.

## Trust boundaries

- **End users (admins):** Google sign-in plus TOTP MFA in production; traffic over HTTPS; browser holds a non-JavaScript-readable session cookie and a CSRF token cookie.
- **Investors (email recipients):** Receive email links (unsubscribe, PDF, attachments) secured with HMAC-signed tokens; no Firestore account required.
- **Firebase client SDK:** Used only for authentication flows; Firestore and Storage are not exposed to the browser (rules deny all; Admin SDK on the server).

## Controls in code

### Authorisation (Firestore is server-only)

- `firestore.rules` and `storage.rules` **deny all** client reads and writes.
- The Firebase **Admin SDK bypasses** those rules, so every protected API uses **`withAdmin`** (`src/server/http/handler.ts`): verify session cookie, require an active row in the **`admins`** allowlist (`src/server/auth/admins.ts`), enforce **CSRF** (double-submit cookie + header) and **same-origin** checks for mutating methods, then apply **per-admin rate limits**.
- Server-rendered app routes call **`requireAdminPage`** (`src/server/auth/session.ts`), which verifies the same session + allowlist or redirects to `/login`.

**Domain membership alone does not grant access;** the allowlist is explicit per email.

### Authentication and session

- **Google** sign-in for real environments; **custom token** sign-in only when Auth emulator is used (dev-login path).
- **TOTP MFA:** Required for session creation when `AUTH_REQUIRE_MFA` is true (`checkLoginToken` / `createSession` in `src/server/auth/session.ts`); production validation in `src/server/env.ts` requires it.
- **HTTP-only session cookie** (`__session`) with `sameSite: strict`; CSRF token is a **separate, non-httpOnly** cookie echoed in header `x-csrf-token` for writes.

### Abuse prevention

- **Rate limiting** via Firestore documents in **`rateLimits`**, keyed by hashed subject (`src/server/ratelimit.ts`); TTL on `expiresAt` (see `firestore.indexes.json`). Buckets include `login`, `read`, `write`, `import`, `upload`, `testSend`, `campaign`, `export`, `publicLink`. Fail-open on Firestore errors for availability.
- **Webhook body size** capped (`src/app/api/webhooks/resend/route.ts`).

### Web and content security

- **Content-Security-Policy** with per-request **nonces** (`src/proxy.ts`); pages redirect unauthenticated users to `/login` (convenience only; routes still verify).
- **`next.config.ts`** sets HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `X-Frame-Options` (DENY for pages; SAMEORIGIN for `/api/*`).

### Logging and audit

- **Structured logger** redacts emails and sensitive keys (`src/server/logger.ts`).
- **Audit trail** in **`auditLogs`** (`src/server/audit.ts`) for security-relevant actions (see `AuditAction` in that file). Dashboard activity filters a subset (`src/server/db/activity.ts`).

### Tokens and public links

- **HMAC-SHA256** tokens for unsubscribe and file downloads (`src/server/tokens.ts`); deterministic payloads support stable campaign content and Resend idempotency keys (`buildRecipientEmail` in `src/server/campaigns/worker.ts`).

### Webhooks

- **Resend** webhooks verified with **Svix** signatures before processing (`src/app/api/webhooks/resend/route.ts`); `svix-id` used for idempotent event documents.

### Content handling

- **Paste sanitisation** in the editor UI (DOMPurify usage in client components).
- **Content schema validation** with Zod so stored updates cannot carry arbitrary HTML or unsafe URLs (`src/lib/content/schema.ts`).

### Import and export

- **CSV formula-injection mitigation** on export via `csvSafe` (`src/lib/import.ts`, used by investor export).

### Email pipeline

- **Sandbox provider** outside production live sending (`src/server/email/index.ts`, `sandbox-provider.ts`): no external mail; records to **`sandboxOutbox`**.
- **Approval flow:** campaigns start as `pending_approval`; **`approveCampaign`** requires matching **`snapshotHash`**, correct update version, and eligible recipients (`src/server/campaigns/approve.ts`). The approve API schema requires **`confirm: true`** (`approveInput` in `src/server/http/schemas.ts`) so approval is explicit in the payload, not a stray POST.
- **Idempotency:** Resend sends use **`idempotencyKey` `campaign-{campaignId}-{recipientId}`** (`buildRecipientEmail`). The worker documents a **23-hour** window aligned with Resend’s idempotency retention (`IDEMPOTENCY_WINDOW_MS` in `src/lib/delivery.ts`); beyond that, interrupted sends can move to **`needs_review`** rather than risk duplicates.

## Secret handling and rotation

| Secret / credential | Role | Rotation guidance |
|---------------------|------|-------------------|
| Firebase service account (`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`) | Admin API access | Rotate in GCP; update Vercel env; deploy |
| `SESSION_MAX_AGE_HOURS` | Session lifetime | Tuning, not a secret |
| `CRON_SECRET` | Worker endpoint | Rotate; update Vercel cron auth |
| `TOKEN_SIGNING_SECRET` | HMAC for links | Rotation invalidates outstanding links; plan a overlap window if needed |
| `RESEND_API_KEY` | Live send | Rotate in Resend dashboard |
| `RESEND_WEBHOOK_SECRET` | Svix verification | Update in Resend webhook config and env |

Never commit real secrets; `.env.example` is a template only.

## Incident response (basics)

1. **Revoke compromised admin:** `npx tsx scripts/admin.ts remove user@example.com` (deactivates allowlist entry and revokes Auth refresh tokens when the user exists).
2. **Rotate secrets:** `CRON_SECRET`, `TOKEN_SIGNING_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and Firebase keys as appropriate.
3. **Stop outbound email:** set **`EMAIL_SENDING_ENABLED=false`** in production (and/or disable Resend API key); `liveSending` becomes false (`src/server/env.ts`).
4. **Review** `auditLogs` and campaign/recipient state; consider Firebase Authentication user disable for broader account compromise.

## Assumptions and limits

- Correct deployment of env vars and Firebase rules is out-of-band; misconfiguration can undermine these controls.
- Rate limiting deliberately fails open on storage errors so authentication remains available.
