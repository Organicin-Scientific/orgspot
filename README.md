# Organicin Investor Updates

Internal admin app for **Organicin Scientific** investor communications: maintain investor contacts and groups, manage a global suppression list, compose document-style updates in a Tiptap editor, preview them (desktop, mobile, PDF, plain text), run limited test sends, and after review submit an explicit **Confirm and send** that queues a durable Firestore job. A worker (cron + post-approval) sends email through **Resend** when `liveSending` is true; **Resend webhooks** drive delivery and engagement into **Firestore**. Analytics and archives surface campaign history, per-recipient status, and engagement.

## Tech stack

| Area | Choices |
|------|---------|
| Framework | Next.js (App Router), React 19, TypeScript |
| Auth | Firebase Auth (Google + TOTP MFA in production), HTTP-only session cookie |
| Data | Cloud Firestore (server-only access via Admin SDK), Firebase Storage for assets and campaign snapshots |
| Email | Resend (live sends), React Email, sandbox provider locally/preview |
| Rich content | Tiptap, Zod-validated content schema |
| PDF | `@react-pdf/renderer` |

Further reading: [Environments](docs/environments.md), [Operations](docs/operations.md), [Deployment](docs/deployment.md), [Security](docs/security.md), [Data model](docs/data-model.md), [Backup & recovery](docs/backup-recovery.md), [Email testing](docs/email-testing.md), [AI drafting](docs/ai-drafting.md). Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).

## Local development (Firebase emulators)

Prerequisites: Node.js, `npm`, **Java** (for the emulators), and `firebase-tools` (installed as a dev dependency).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template and edit as needed:

   ```bash
   cp .env.example .env.local
   ```

3. Start emulators (imports `./.emulator-data` on start, exports on exit):

   ```bash
   npm run emulators
   ```

4. Seed synthetic data (intended for the emulator only):

   ```bash
   npm run seed
   ```

   The seed creates an allowlisted admin `dev@example.com` (among other data).

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open the app and sign in.

   - **Google + MFA path:** use the normal login flow when not using emulator-only shortcuts.
   - **Emulator dev login:** set `NEXT_PUBLIC_AUTH_EMULATOR_LOGIN=true` and ensure `FIREBASE_AUTH_EMULATOR_HOST` (and related emulator vars) match `.env.example`. The login page shows **Local emulator sign-in** only in that configuration.  
   - The dev-login API (`POST /api/auth/dev-login`) only works when the Auth emulator is configured, the environment is not production, and MFA is not required (`AUTH_REQUIRE_MFA` must be false). It checks the email against the Firestore **admins** allowlist (`getAdmin` with a fresh read); if the user is not on the list, sign-in is forbidden. It mints a session for an existing or newly created Auth user with that email.

## npm scripts

| Script | Purpose |
|--------|---------|
| `dev` | Next.js development server |
| `build` | Production build |
| `start` | Run production server |
| `lint` | ESLint |
| `test` | Unit tests (Vitest, `unit` project) |
| `test:emulator` | Run tests against emulators (`firebase emulators:exec`) |
| `emulators` | Start Auth, Firestore, Storage emulators with import/export |
| `admin` | CLI for Firestore `admins` (`tsx scripts/admin.ts`) |
| `seed` | Seed emulator data (`tsx scripts/seed.ts`) |
| `typecheck` | `tsc --noEmit` |

## Project structure (overview)

| Path | Role |
|------|------|
| `src/app/(app)/` | Authenticated app routes (dashboard, investors, updates, send flow, analytics, settings) |
| `src/app/login/` | Login UI and emulator dev sign-in |
| `src/app/api/` | Route handlers (auth, CRUD, campaigns, webhooks, internal worker, assets, previews) |
| `src/server/` | Firebase Admin, env, HTTP helpers (`withAdmin`), campaigns worker, email, storage, audit, rate limits |
| `src/lib/` | Shared types, content schema, import/export helpers, delivery logic |
| `src/components/` | UI components |
| `src/emails/` | React Email templates |

Firebase security rules deny direct client access to Firestore and Storage; the app uses server routes with the Admin SDK.

## Documentation index

- [docs/deployment.md](docs/deployment.md) — Vercel, Firebase production, Resend, cron, environment variables  
- [docs/investor-import.md](docs/investor-import.md) — CSV/xlsx import for real contact lists  
- [docs/security.md](docs/security.md) — Threat model and controls  
- [docs/data-model.md](docs/data-model.md) — Firestore collections and Storage paths  
- [docs/backup-recovery.md](docs/backup-recovery.md) — Backups, recovery, interrupted sends  
- [docs/email-testing.md](docs/email-testing.md) — Safe testing, sandbox, webhooks  
