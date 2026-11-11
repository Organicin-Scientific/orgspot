# GitHub Actions setup (send worker)

The **Send worker** workflow (`.github/workflows/send-worker.yml`) calls production every 10 minutes so campaign retries are not stuck until the daily Vercel cron.

## Required configuration

| Type | Name | Value |
|------|------|--------|
| Repository **variable** | `ORGSPOT_URL` | `https://investor.organicinscientific.com` |
| Repository **secret** | `CRON_SECRET` | Same as Vercel Production env `CRON_SECRET` |

**Settings → Secrets and variables → Actions**

Until `ORGSPOT_URL` is set, the scheduled job does not run (by design).
