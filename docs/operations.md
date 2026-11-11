# Operations runbook

Canonical app URL: **https://investor.organicinscientific.com**  
Vercel project: **orgspot** · Firebase project: **orgspot-afbf7** (`production` alias in `.firebaserc`)

## What “cron” is

**Cron** is a schedule that calls a URL automatically — like an alarm clock for your server.

| Mechanism | Schedule | What it hits | Purpose |
|-----------|----------|--------------|---------|
| **Vercel Cron** (`vercel.json`) | Once daily at **11:00 UTC** (~6:00 AM US Eastern) | `GET /api/internal/worker` with `Authorization: Bearer CRON_SECRET` | Safety net: resume interrupted campaign sends, drain backlog if a serverless run died |
| **GitHub Actions** (`send-worker.yml`) | Every **10 minutes** (when configured) | Same worker URL | Faster retries inside Resend’s **23-hour** idempotency window so transient failures don’t become `needs_review` |

Approving a campaign still starts the worker **immediately** in the approve handler. Cron and GitHub only help **recovery** and large lists.

### Enable the 10-minute worker (one-time)

Repository **Settings → Secrets and variables → Actions**:

1. **Variable** `ORGSPOT_URL` = `https://investor.organicinscientific.com` (no trailing slash)
2. **Secret** `CRON_SECRET` = same value as Vercel Production `CRON_SECRET`

Until `ORGSPOT_URL` is set, the workflow is skipped (see `if: ${{ vars.ORGSPOT_URL != '' }}`).

## Health check

`GET /api/health` — no auth. Returns `ok`, `appEnv`, `liveSending`, `aiDraft`, `firebaseProjectId` (no secrets).

## Administrators

```bash
# Production (uses .env.local or ADC with orgspot-afbf7)
firebase use production
npx tsx scripts/admin.ts add admin@company.com
npx tsx scripts/admin.ts list
npx tsx scripts/admin.ts remove admin@company.com
```

## Firebase rules and indexes

```bash
firebase use production
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Rules in repo deny all client access; the Next.js server uses the Admin SDK.

## Resend

- Webhook URL: `https://investor.organicinscientific.com/api/webhooks/resend`
- Live sending only when `liveSending` is true (production + `EMAIL_SENDING_ENABLED` + API key).

## Vertex drafting

See [ai-drafting.md](./ai-drafting.md). Production: `AI_DRAFT_ENABLED=true`. Preview should keep drafting **off** unless you accept Gemini cost on throwaway deploys.

## Interrupted sends

1. Campaign analytics → **Continue sending** (POST worker as admin), or wait for GitHub/Vercel cron.
2. Sends older than **23 hours** without completion may move to **`needs_review`** (duplicate-send guard).

## Secret rotation (pointers)

| Secret | Touch when rotating |
|--------|---------------------|
| `CRON_SECRET` | Vercel, GitHub Actions secret, any external cron |
| `TOKEN_SIGNING_SECRET` | Vercel; invalidates outstanding PDF/unsubscribe links |
| `RESEND_*` | Resend dashboard + Vercel |

See [deployment.md](./deployment.md) and [security.md](./security.md).
