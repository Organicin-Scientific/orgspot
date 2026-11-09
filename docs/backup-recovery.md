# Backup and recovery

Investor data and campaign history live primarily in **Firestore**; large blobs (images, attachments, frozen email snapshots) live in **Cloud Storage**. Plan backups around both.

## Firestore: point-in-time recovery

Enable **Point-in-Time Recovery (PITR)** on the production Firestore database in the Google Cloud Console (Firestore → Database → Disaster recovery). PITR allows restoring to a timestamp within the retention window if logical data is corrupted or deleted.

For broader durability, use **scheduled exports** or managed backup (see below).

## Scheduled backups (GCP)

Use the Cloud Firestore **backup** APIs or `gcloud` to create recurring backups. Example pattern (adjust project, location, and schedule names):

```bash
gcloud firestore backups schedules create \
  --project=YOUR_PROJECT_ID \
  --database='(default)' \
  --recurrence=DAILY \
  --retention=YOUR_RETENTION \
  --backup-location=YOUR_BACKUP_LOCATION
```

Consult current `gcloud` documentation for required flags (`--backup-location`, retention format, etc.). Store backups in a **dedicated GCS region** and **restrict IAM** to backup operators only.

**Export to GCS** (optional periodic full export for long-term archival):

```bash
gcloud firestore export gs://YOUR_BUCKET/path/ --project=YOUR_PROJECT_ID
```

Exports are consistent; import requires planning for overwrite vs merge (treat as a restore exercise, not a casual operation).

## Cloud Storage

- Enable **Object Versioning** (and/or **Soft Delete**) on the bucket that backs Firebase Storage so overwritten campaign snapshots or assets can be recovered.
- Mirror backup policy in IAM: least-privilege service accounts; separate buckets for exports if useful.

## Restore workflow (high level)

1. **Stop writes** if corruption is spreading (disable app deploy, maintenance mode, or revoke credentials depending on severity).
2. **Restore Firestore** from PITR or a backup/export into a **new** database or project first, validate, then cut over or merge with extreme caution.
3. **Restore Storage** from versioned objects or backup bucket as needed; paths are deterministic (`campaigns/{campaignId}/...`, `assets/...`, `attachments/...` — see [data-model.md](data-model.md)).

Always rehearse restore steps on a **non-production** project periodically.

## Interrupted campaign sends

Send progress is **durable** in Firestore:

- **`jobs`** documents track queued/running work; **`/api/internal/worker`** (Vercel Cron) reclaims expired leases and continues processing (`src/server/campaigns/worker.ts`).
- Each outbound email uses a deterministic **`idempotencyKey`** (`campaign-{campaignId}-{recipientId}`) with Resend (`src/server/campaigns/worker.ts`, `src/server/email/resend-provider.ts`).
- If a recipient sits **too long** past the **idempotency window** (~23 hours, `IDEMPOTENCY_WINDOW_MS` in `src/lib/delivery.ts`) while still retrying, the worker may set status **`needs_review`** instead of risking a duplicate send.

**After recovery:** confirm `jobs` and `recipients` state; resolve `needs_review` rows manually if any appear.

## Periodic restore drills

- Once per quarter (or per your policy), restore **a copy** of a backup to a scratch project and verify document counts, a sample investor, and one campaign snapshot path in Storage.
- Document drill outcomes and any gaps (indexes, rules, Storage CORS).
