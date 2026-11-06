# Data model (Firestore and Storage)

All client access to Firestore and Storage is **denied by rules**; the Next.js server uses the **Admin SDK**. This reference is derived from `src/server/db/*.ts`, `src/server/campaigns/*.ts`, `src/server/auth/*.ts`, `src/server/ratelimit.ts`, `src/server/audit.ts`, `src/lib/types.ts`, and `firestore.indexes.json`.

## Top-level collections

### `investors`

Investor contacts.

| Field | Type | Notes |
|-------|------|-------|
| `firstName`, `lastName` | string | |
| `email` | string | Display/source email |
| `emailNormalized` | string | Normalised key for matching |
| `organization`, `category`, `notes` | string | |
| `status` | string | `active` \| `unsubscribed` \| `bounced` \| `suppressed` (`INVESTOR_STATUSES`) |
| `groupIds` | string[] | Investor group membership |
| `searchTokens` | string[] | Prefix tokens for search (capped) |
| `sortKey` | string | `lastName \0 firstName \0 id` for ordering |
| `createdAt`, `updatedAt` | timestamp | |
| `createdBy` | string | Email of creator |

**Subcollection:** `investors/{id}/history` — change log entries (`at`, `actor`, `changes`).

### `investorEmails` (email uniqueness guard)

Document **id** = normalised email. One document per unique investor email.

| Field | Type |
|-------|------|
| `investorId` | string |

Created/deleted in the same transactions as investor create/update/delete (`src/server/db/investors.ts`).

### `investorGroups`

| Field | Type |
|-------|------|
| `name`, `nameLower`, `description` | string |
| `memberCount` | number |
| `createdBy` | string |
| `createdAt`, `updatedAt` | timestamp |

### `suppressionList`

Global suppression keyed by normalised email (document id).

| Field | Type |
|-------|------|
| `email` | string (duplicate of id) |
| `reason` | `unsubscribe` \| `bounce` \| `complaint` \| `manual` |
| `source` | string |
| `createdAt` | timestamp |
| `updatedAt` | optional (e.g. when upgrading reason to complaint) |

### `updates`

Email/update drafts and sent records.

| Field | Type |
|-------|------|
| `title`, `subject`, `previewText` | string |
| `content` | JSON (TipTap doc; validated by schema) |
| `bannerAssetId` | string \| null |
| `attachmentIds` | string[] (max 10 on save) |
| `pdfDelivery` | `attach` \| `link` \| `none` |
| `status` | `draft` \| `ready` \| `sending` \| `sent` \| `failed` |
| `version` | number |
| `searchTokens` | string[] |
| `createdBy`, `updatedBy` | string |
| `createdAt`, `updatedAt` | timestamp |
| `lastRevisionAt` | timestamp \| null |
| `pendingCampaignId` | string \| null |
| `sentCampaignId` | string \| null |
| `sentAt` | timestamp \| null |
| `duplicatedFrom` | string \| null |

**Subcollection:** `updates/{id}/revisions` — autosave/manual/restore snapshots (`title`, `subject`, `previewText`, `content`, `version`, `reason`, `createdBy`, `createdAt`).

### `contentBlocks`

Reusable content snippets.

| Field | Type |
|-------|------|
| `name` | string |
| `content` | JSON (validated doc) |
| `createdBy` | string |
| `createdAt` | timestamp |

### `campaigns`

Prepared send snapshot and aggregate stats.

| Field | Type |
|-------|------|
| `updateId`, `updateVersion` | string / number |
| `title`, `subject`, `previewText` | string |
| `sender` | `{ fromName, fromEmail, replyTo }` |
| `branding` | branding snapshot (e.g. company colours, logo id) |
| `postalAddress` | string (footer compliance) |
| `audience` | `{ groupIds, groupNames, allActive }` |
| `pdfDelivery` | string |
| `attachments` | `{ id, filename, mime, storagePath }[]` |
| `assetIds` | string[] (images/logo for publishing) |
| `snapshotHash` | string (SHA-256 over HTML, text, PDF hash, subject, preview, sender, pdfDelivery, sorted recipient ids) |
| `htmlBytes` | number (rendered HTML size for Gmail clip check) |
| `pdfSha` | string \| null |
| `status` | see `CAMPAIGN_STATUSES` in `src/lib/types.ts` |
| `approved` | boolean (indexed for history queries) |
| `stats` | `CampaignStats` (counts: selected, eligible, excluded, accepted, delivered, etc.) |
| `searchTokens` | string[] |
| `createdBy` | string |
| `createdAt` | timestamp |
| `approval` | `{ approvedBy, approvedAt }` \| null |
| `approvedAt` | timestamp \| null |
| `startedAt`, `completedAt`, `cancelledAt` | timestamp \| null |
| `lastError` | string \| null |
| `needsReview` | number (recipient(s) stuck for human review; set on completion) |

**Subcollection:** `campaigns/{id}/recipients`

| Field | Type |
|-------|------|
| `investorId` | string (document id = investor id) |
| `email`, `emailNormalized` | string |
| `firstName`, `lastName`, `organization` | string |
| `sortKey` | string |
| `status` | see `RECIPIENT_STATUSES` |
| `attempts` | number |
| `providerMessageId` | string \| null |
| `lastError` | string \| null |
| `queuedAt`, `firstAttemptAt`, `lastAttemptAt` | timestamp |
| `acceptedAt`, `deliveredAt`, `bouncedAt`, `complainedAt`, `failedAt`, `openedAt`, `clickedAt`, `unsubscribedAt` | timestamp \| null |
| `leaseUntil`, `nextAttemptAt` | timestamp \| null (worker leasing / retry) |

**Subcollection:** `campaigns/{id}/excluded` — doc id = `investorId`; `name`, `email`, `reason` (`unsubscribed` \| `bounced` \| `suppressed` \| `suppression_list`).

### `jobs`

Durable send queue; **document id equals `campaignId`**.

| Field | Type |
|-------|------|
| `type` | e.g. `campaign.send` |
| `campaignId` | string |
| `status` | `queued` \| `running` \| `done` |
| `runAfter` | timestamp |
| `leaseUntil`, `leaseOwner` | timestamp / string \| null |
| `attempts` | number |
| `createdAt`, `completedAt` | timestamp |

### `emailEvents`

Ingested provider webhook events; **document id** derived from provider delivery id (normalised).

| Field | Type |
|-------|------|
| `type` | Normalised event type |
| `campaignId`, `recipientId` | string \| null |
| `messageId` | string |
| `occurredAt`, `receivedAt` | timestamp |
| `detail` | string \| null |
| `test` | boolean (test-send events) |
| `orphan` | boolean (recipient doc missing) |

### `providerMessages`

Maps Resend message id to internal campaign/recipient (for webhooks missing tags).

| Field | Type |
|-------|------|
| `campaignId` | string |
| `recipientId` | string |

### `assets`

Metadata for Storage objects (`src/server/storage.ts`).

| Field | Type |
|-------|------|
| `kind` | `image` \| `attachment` |
| `filename`, `mime` | string |
| `size` | number |
| `storagePath` | string |
| `sha256` | string |
| `published` | boolean |
| `publishedAt` | optional timestamp |
| `createdBy` | string |
| `createdAt` | timestamp |

### `settings` / `settings/app`

Singleton app settings document.

| Field | Type |
|-------|------|
| `branding` | `companyName`, `logoAssetId`, colours, `fontFamily` |
| `sender` | `fromName`, `fromEmail`, `replyTo` |
| `postalAddress`, `footerNote` | string |
| `updatedAt`, `updatedBy` | timestamp \| string \| null |

### `admins`

Allowlist for admin sign-in; **document id** = normalised email.

| Field | Type |
|-------|------|
| `email` | string |
| `role` | `admin` |
| `active` | boolean |
| `uid` | string \| null (bound on login) |
| `addedAt`, `lastLoginAt`, `removedAt` | timestamps as applicable |
| `addedBy` | string |

### `auditLogs`

| Field | Type |
|-------|------|
| `actorEmail` | string |
| `action` | string (see `AuditAction` in `src/server/audit.ts`) |
| `resourceType` | string |
| `resourceId` | string \| null |
| `summary` | string |
| `metadata` | optional map |
| `at` | timestamp |

### `rateLimits`

| Field | Type |
|-------|------|
| `count` | number |
| `name` | string (bucket name) |
| `expiresAt` | timestamp (**TTL** field in `firestore.indexes.json`) |

### `sandboxOutbox`

Records from **`SandboxProvider.send`** (non-live environments).

| Field | Type |
|-------|------|
| `messageId` | string (`sbx_` + hash) |
| `idempotencyKey` | string |
| `toDomain` | string |
| `subject` | string |
| `htmlBytes`, `textBytes` | numbers |
| `attachments` | `{ filename, bytes }[]` |
| `headers` | string[] (header names only) |
| `tags` | object |
| `flakyAttempted` | optional boolean |
| `sends` | counter |
| `createdAt` | timestamp |

**TTL:** `expiresAt` with TTL policy in `firestore.indexes.json`.

### `testSends`

Audit-style rows for test emails (`src/server/campaigns/test-send.ts`).

| Field | Type |
|-------|------|
| `updateId`, `updateVersion` | string / number |
| `recipientCount` | number |
| `recipientDomain` | string |
| `ok` | boolean |
| `providerMessageId` | string \| null |
| `provider` | string (`resend` \| `sandbox`) |
| `sentBy` | string |
| `at` | timestamp |

### `meta`

| Document | Purpose |
|----------|---------|
| `meta/investorCategories` | `values`: string[] of seen categories |
| `meta/seed` | Seed script version marker (`scripts/seed.ts`) |

## Storage (Firebase Storage) paths

Bucket: `FIREBASE_STORAGE_BUCKET`. Rules deny direct client access.

| Path pattern | Purpose |
|--------------|---------|
| `assets/{assetId}.{ext}` | Uploaded images (PNG, JPEG, GIF, WebP) |
| `attachments/{assetId}.{ext}` | PDF, DOCX, XLSX, PPTX attachments |
| `campaigns/{campaignId}/email.html` | Frozen HTML snapshot |
| `campaigns/{campaignId}/email.txt` | Plain-text snapshot |
| `campaigns/{campaignId}/update.pdf` | Generated PDF when `pdfDelivery` is not `none` |

## Recipient delivery status precedence

Provider events are applied in **`applyProviderEvent`** (`src/lib/delivery.ts`):

- **Status rank** (low to high): `queued`, `sending`, `retry_wait`, `needs_review`, `skipped` (rank 0) → `accepted` (1) → `delivered` (2) → `failed` (3) → `bounced` (4) → `complained` (5). A later event only moves status **up** this ladder (for example a late `delivered` cannot overwrite `bounced`).
- **Timestamps** (`acceptedAt`, `deliveredAt`, …) are set **once**; stats increment per first-time timestamp.
- **`delivery_delayed`**, **`opened`**, **`clicked`** set timestamps but map to status `accepted` when no stronger status applies; they also imply acceptance if `sent` was missed.

Handled **normalised** provider types include: `sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `failed`, `suppressed` (`PROVIDER_EVENT_TYPES` in `src/lib/delivery.ts`).

## Firestore indexes and TTL (`firestore.indexes.json`)

- **Composite indexes** exist for investor listing (status/category/group/search), updates listing, campaigns (approved/history), recipients (status, retries, leases, collection-group history), `emailEvents`, `jobs`, and `auditLogs`.
- **TTL policies:** `rateLimits.expiresAt` and `sandboxOutbox.expiresAt` (field overrides with `ttl: true`).
