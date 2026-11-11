# Environments

| | **Local** | **Vercel Preview** | **Vercel Production** |
|---|-----------|-------------------|----------------------|
| `APP_ENV` | `local` | `preview` | `production` |
| `VERCEL_ENV` | — | `preview` | `production` |
| `APP_URL` | `http://localhost:3000` | Injected from `VERCEL_URL` if `APP_URL` unset | `https://investor.organicinscientific.com` |
| Firebase | Emulators (`demo-organicin`) | **orgspot-afbf7** (today) | **orgspot-afbf7** |
| Live email (`liveSending`) | Never | Never | When `EMAIL_SENDING_ENABLED=true` |
| Gemini draft | Optional (emulator / off) | Off by default | On when configured |
| MFA required | Configurable (`AUTH_REQUIRE_MFA=false` locally) | Typically `false` | `true` |

## Preview deployments

Preview builds are PR branches on Vercel (`*.vercel.app`). They should **not** send live email or run Vertex drafting against production data unless you intend to.

Recommended Vercel **Preview** overrides:

- `APP_ENV=preview`
- `EMAIL_SENDING_ENABLED=false`
- `AI_DRAFT_ENABLED=false`
- `AUTH_REQUIRE_MFA=false` (optional; easier QA on PR URLs)

`APP_URL` can be omitted on Preview: the server resolves `https://${VERCEL_URL}` when `APP_ENV` or `VERCEL_ENV` is `preview`.

**Important:** Preview currently shares the **production Firebase project**. PR deploys can read/write the same Firestore and Storage as production. For stronger isolation, create a dedicated Firebase project for Preview and point Preview env vars at it (see [deployment.md](./deployment.md)).

## Secrets on Preview

Production Firebase and signing secrets must also be available to Preview (Vercel: enable each secret for **Preview** as well as Production) or preview builds will fail at runtime. Never enable `EMAIL_SENDING_ENABLED` on Preview.

## Local

Copy `.env.example` → `.env.local`, run `npm run emulators`, `npm run seed`, set `NEXT_PUBLIC_AUTH_EMULATOR_LOGIN=true` for dev login.
