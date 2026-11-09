# Deployment (Vercel + Firebase)

This app is designed to run on **Vercel** with **Firebase** (Auth, Firestore, Storage) and **Resend** for outbound email. Treat production and non-production as separate trust zones.

## Separate Firebase projects

Use **distinct Firebase/GCP projects** for production versus preview and local development. Preview and development deployments must **not** receive production service account keys, production `FIREBASE_*` credentials, or the production **Resend** API key.

Configure Vercel environment variables **per environment** (Production vs Preview) so preview builds point at a non-production Firebase project (or omit dangerous secrets entirely).

## When email actually sends

From `src/server/env.ts` and `src/server/email/index.ts`:

- **`liveSending`** is `true` only when **`isProduction` is true** (`APP_ENV === "production"` **or** `VERCEL_ENV === "production"`) **and** `EMAIL_SENDING_ENABLED` is true **and** `RESEND_API_KEY` is set.
- Local development, tests, and **Vercel Preview** therefore use the **sandbox** email provider: messages are recorded (for example in Firestore) and are not sent through Resend as live mail.
- If `EMAIL_SENDING_ENABLED` is true, validation also requires `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (see `env.ts`).

**`EMAIL_SENDING_ENABLED` must only be true in production** when the organisation intends real sending; keep it false everywhere else.

## Environment variables

Variables are defined in `.env.example` and validated in `src/server/env.ts`. Below: purpose and typical placement.

| Variable | Purpose | Notes |
|----------|---------|--------|
| `NODE_ENV` | `development` / `test` / `production` | Standard Node |
| `VERCEL_ENV` | Injected on Vercel: `development` / `preview` / `production` | Drives `isProduction` with `APP_ENV` |
| `APP_ENV` | `local` / `preview` / `production` | Local emulator: `local` |
| `APP_URL` | Canonical base URL for links | Must be `https://` in production (enforced) |
| `FIREBASE_PROJECT_ID` | GCP/Firebase project | Must match `ALLOWED_FIREBASE_PROJECT_ID` in production |
| `FIREBASE_CLIENT_EMAIL` | Service account email | Omit with emulators / ADC-only setups per your workflow |
| `FIREBASE_PRIVATE_KEY` | Service account PEM | Use `\n` in env files |
| `FIREBASE_STORAGE_BUCKET` | GCS bucket for Storage | Often `<project-id>.appspot.com` |
| `ALLOWED_FIREBASE_PROJECT_ID` | Guard against wrong project | Required in production; must equal `FIREBASE_PROJECT_ID` |
| `FIRESTORE_EMULATOR_HOST` | Firestore emulator | **Unset** in production (validation error if set) |
| `FIREBASE_AUTH_EMULATOR_HOST` | Auth emulator | **Unset** in production |
| `FIREBASE_STORAGE_EMULATOR_HOST` | Storage emulator | Local only |
| `AUTH_REQUIRE_MFA` | Enforce TOTP MFA on session creation | Must be `true` in production |
| `SESSION_MAX_AGE_HOURS` | Session cookie lifetime | Bounded in schema |
| `EMAIL_SENDING_ENABLED` | Opt-in to live Resend | Only true in production when ready |
| `RESEND_API_KEY` | Resend API key | Required when live sending is enabled |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for webhooks | Required when `EMAIL_SENDING_ENABLED=true`; 503 on webhook route if missing |
| `RESEND_MAX_REQUESTS_PER_SECOND` | Send pacing | Default 2 |
| `SENDER_EMAIL` | Default sender domain check in settings | See `src/server/db/settings.ts` |
| `CRON_SECRET` | Bearer for `/api/internal/worker` | Minimum 32 characters |
| `TOKEN_SIGNING_SECRET` | HMAC for unsubscribe and file tokens | Minimum 32 characters |
| `PDF_LINK_TTL_DAYS` | Expiry for signed download links | Default 30 |
| `AI_DRAFT_ENABLED` | Vertex Gemini template drafting in the update editor | Default false; needs service account + Vertex AI API |
| `GEMINI_MODEL` | Vertex model id | Default `gemini-3.8-flash` |
| `VERTEX_GEMINI_LOCATION` | Vertex region | Default `us-central1` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client Firebase config | Public |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client auth domain | Often set to the **app’s own domain** in production (see below) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client project id | Public |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client app id | Public |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | Auth emulator host:port | Empty in production |
| `NEXT_PUBLIC_AUTH_EMULATOR_LOGIN` | Show emulator-only dev login | `true` for local emulators only |

## Firebase: rules and indexes

Deploy rules and indexes to the target project:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
```

- `firestore.rules` and `storage.rules` deny all client access; the Next.js server uses the Admin SDK.
- Composite indexes and TTL field overrides live in `firestore.indexes.json` (for example TTL on `rateLimits.expiresAt` and `sandboxOutbox.expiresAt`).

## Auth: Google, MFA, and auth domain

- Enable the **Google** sign-in provider and **TOTP** multi-factor authentication in Firebase. TOTP MFA in the client uses Identity Platform-style multi-factor APIs; ensure the Firebase project supports TOTP enrolment as used by the login UI.
- Add your production web origin to Firebase **Authorised domains**.

### Auth domain and rewrites

`next.config.ts` rewrites `/_/auth/*` to `https://<NEXT_PUBLIC_FIREBASE_PROJECT_ID>.firebaseapp.com/_/auth/*` so Firebase Auth can use your **app hostname** as `authDomain` and avoid third-party cookie issues.

Set **`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`** to your deployed hostname (for example `updates.organicin.com`), not only the default `*.firebaseapp.com` domain, when following this pattern.

## First admin (Firestore allowlist)

Administrators are explicit documents in the `admins` collection (keyed by normalised email). The CLI loads `.env.local` when present:

```bash
npx tsx scripts/admin.ts add you@company.com
```

or:

```bash
npm run admin -- add you@company.com
```

Use `list` and `remove` per the script header in `scripts/admin.ts`.

## Vercel Cron

`vercel.json` schedules a **once-daily** cron (Hobby plan limit), at **11:00 UTC** (~6:00 US Eastern):

- **Path:** `GET /api/internal/worker`
- **Authorisation:** `Authorization: Bearer <CRON_SECRET>` (compare `src/app/api/internal/worker/route.ts`)

Approving a campaign still starts sending immediately in the API handler (`after()` drain). The cron is for recovery, retries, and any backlog if a run was interrupted.

Admins can also **POST** `/api/internal/worker` (session + CSRF) from the campaign analytics page to continue a large send without waiting for cron.

When a run ends with recipients still queued, the worker starts a fresh invocation of itself (`src/server/campaigns/continuation.ts`), so large lists finish without a manual resume. Chaining stops after 60 hops.

### Frequent schedule via GitHub Actions

The Hobby plan allows only a daily Vercel cron, and the worker moves any send interrupted for more than 23 hours to manual review. `.github/workflows/send-worker.yml` calls the worker every 10 minutes so retries run on time. To enable it, add a repository **variable** `ORGSPOT_URL` (for example `https://orgspot.vercel.app`) and a repository **secret** `CRON_SECRET` matching Vercel. The job is skipped until `ORGSPOT_URL` exists.

Set `CRON_SECRET` in Vercel (production) to a long random value and match it in the platform’s cron secret configuration if applicable.

## Resend

1. Add a **dedicated sending subdomain** (for example `updates.organicin.com`) in Resend.
2. Add **SPF** and **DKIM** records Resend provides for that domain.
3. Add **DMARC** for the subdomain (policy aligned with your security posture).
4. Configure the **webhook** URL: `https://<your-app-domain>/api/webhooks/resend`.
5. Subscribe to events that map to the normaliser in `src/server/campaigns/events.ts` / `src/lib/delivery.ts`, including: `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `failed` (and `suppressed` where emitted). Raw payloads use Resend’s `email.<event>` naming; ignored types return `{ ok: true, ignored: true }`.
6. Put the Svix signing secret into **`RESEND_WEBHOOK_SECRET`** (used by `Webhook` from the `svix` package in `src/app/api/webhooks/resend/route.ts`).
7. **Open/click tracking** toggles are per domain in Resend (surfaced in the API via domain status in `src/server/email/resend-provider.ts`).

## Node.js and `firebase-admin`

`firebase-admin` pulls in `jwks-rsa`, which must load `jose` on Node without `NODE_OPTIONS=--experimental-require-module`. This repo pins **`jose@5.9.6`** under `jwks-rsa` via `package.json` `overrides` so session verification works on Vercel with Node 22.x. After deploying that change, **remove** the `NODE_OPTIONS=--experimental-require-module` production env var.

## Pre-launch checklist

- [ ] Production Firebase project isolated from dev/preview; Vercel Production env vars only on Production  
- [ ] `ALLOWED_FIREBASE_PROJECT_ID` matches `FIREBASE_PROJECT_ID`; emulator host vars **unset** in production  
- [ ] `APP_URL` is `https://` and matches the live hostname  
- [ ] `AUTH_REQUIRE_MFA=true`; Google + TOTP enabled; authorised domains correct  
- [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` set to the app domain if using auth rewrites  
- [ ] Firestore rules, indexes, and Storage rules deployed  
- [ ] At least one `admins` document for a real operator email  
- [ ] Resend domain verified; SPF/DKIM/DMARC in place  
- [ ] Webhook endpoint reachable publicly; `RESEND_WEBHOOK_SECRET` set  
- [ ] `EMAIL_SENDING_ENABLED=true` **only** when deliberately enabling live send (plus `RESEND_API_KEY`)  
- [ ] `CRON_SECRET` set on Vercel; cron hitting `/api/internal/worker` with Bearer auth  
- [ ] `TOKEN_SIGNING_SECRET` and other secrets are strong and unique to production  

**Deploying to production and sending real email to investors must have explicit owner approval.** This document is operational guidance only, not authorisation to go live.
