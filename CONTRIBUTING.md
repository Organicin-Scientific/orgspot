# Contributing

## Docs

| Doc | Topic |
|-----|--------|
| [README.md](./README.md) | Local dev, scripts |
| [docs/environments.md](./docs/environments.md) | Local vs Preview vs Production |
| [docs/operations.md](./docs/operations.md) | Cron, worker, admins, health |
| [docs/deployment.md](./docs/deployment.md) | Vercel + Firebase + Resend |
| [docs/security.md](./docs/security.md) | Threat model |

## Branch and CI

- Branch from `main` as `cursor/<topic>-f9ba` for agent PRs.
- CI: lint, typecheck, unit tests, integration tests with emulators (`/.github/workflows/ci.yml`).

## Before you push

```bash
npm run lint
npm run typecheck
npm test
```

## Firebase CLI

```bash
firebase use default          # demo-organicin + emulators
firebase use production       # orgspot-afbf7
```

Do not commit `.env.local` or service account keys.
