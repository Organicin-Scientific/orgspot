# Email testing (safe operations)

Use non-production environments and the **sandbox** email path by default. **Live sending** only occurs when `liveSending` is true (`src/server/env.ts`, `src/server/email/index.ts`).

## Sandbox provider (local, preview, CI)

When not using Resend for live sends, **`SandboxProvider`** runs (`src/server/email/sandbox-provider.ts`):

- Nothing is delivered as real mail.
- Each accepted send writes a **metadata-only** document to **`sandboxOutbox`** (`messageId`, `idempotencyKey`, `toDomain`, subject, byte lengths of HTML/text, attachment sizes, header **names**, tags, incremental `sends`, timestamps). TTL may apply via `firestore.indexes.json`.
- After a successful sandbox send, the worker **simulates** provider events (`sent`, `delivered`, and sometimes `bounced` / `complained`) by calling **`ingestEvent`** with fake ids (`sandboxOutcome` in `sandbox-provider.ts`).
- **Synthetic recipient domains** force behaviours:
  - `*@bounce.test` — permanent bounce path
  - `*@complaint.test` — complaint path
  - `*@fail.test` — permanent rejection (no success)
  - `*@flaky.test` — first attempt retryable failure, second succeeds

Use these addresses in non-production flows instead of real investor mailboxes.

## Test sends from the UI

- The test-send dialog allows **up to five** comma-separated addresses (`src/app/(app)/updates/[id]/test-send-dialog.tsx`).
- Subjects are prefixed with **`[TEST]`** (`src/server/campaigns/test-send.ts`).
- Each attempt is logged to **`testSends`** with `provider` (`resend` vs `sandbox`), `ok`, optional `providerMessageId`, and `recipientDomain`.
- **Resend test inboxes** (`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`) only behave as documented when your configuration actually talks to Resend’s test infrastructure. Prefer using **`EMAIL_SENDING_ENABLED=false`** outside production so the sandbox captures traffic instead of real mail.

## Previews

- **Desktop / mobile / PDF / plain text** preview routes use the same render pipeline with `mode: "preview"` or related paths (`GMAIL_CLIP_BYTES` = **102 KiB** for Gmail clipping warning in `src/server/email/render.ts` and preview API).
- Unpublished images use **short-lived asset preview tokens** (`assetPreviewToken` in `src/server/tokens.ts`).

## Webhooks in local development

- The Resend webhook handler requires **`RESEND_WEBHOOK_SECRET`**; otherwise it returns **503** (`src/app/api/webhooks/resend/route.ts`).
- To exercise webhooks locally, run the app with a tunnel (for example ngrok or Cloudflare Tunnel) pointing at your dev server, register the public URL + `/api/webhooks/resend` in the Resend dashboard, and use a **non-production** Resend project if possible.

## Data hygiene

- Do **not** load confidential investor lists into shared or non-production Firebase projects.
- Prefer **`npm run seed`** against the **emulator** for synthetic contacts.
- For campaign QA, rely on **sandbox** delivery and synthetic domains before enabling **live** sending in production with **explicit owner approval**.
