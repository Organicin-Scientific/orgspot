# Importing investor contacts

Use **Investors → Import** (`/investors/import`) in production. Nothing is written until you confirm on the review step, and **import never sends email**.

## File requirements

| Requirement | Detail |
|-------------|--------|
| Formats | `.csv` or `.xlsx` only (save Google Sheets or `.xls` as CSV/xlsx first) |
| Size | Up to 4 MB |
| Rows | Up to 5,000 data rows per file (split larger lists) |
| Header row | Required; first row = column headings |

## Columns

| Field | Required | Notes |
|-------|----------|--------|
| Email | **Yes** | Invalid or duplicate-in-file rows are skipped |
| First / last name | No | Or map a single **Full name** column |
| Organization | No | Firm or fund name |
| Category | No | Free text; used for filtering and reporting |
| Notes | No | Internal only |

Auto-mapping recognises common headers (HubSpot, spreadsheets, Google Contacts `E-mail 1 - Value`, etc.).

## Duplicate handling

On import you choose:

- **Skip existing** — leave current records unchanged (default).
- **Fill empty fields only** — add missing names, org, category, notes and add selected groups; never overwrite non-empty fields.

## Suppression and consent

- The app does not send on import.
- Addresses already on the **suppression list** (unsubscribe, bounce, complaint, manual) are still imported when new but marked **unsubscribed** or **bounced** and **excluded from sends**.
- Only import people who should receive investor updates under your consent policy.

## HubSpot export

1. **Contacts** → filter or select → **Export**.
2. Choose **CSV**.
3. Upload in the import wizard and confirm column mapping.

## Google Contacts export

1. [Google Contacts](https://contacts.google.com) → **Export**.
2. Choose **Google CSV**.
3. Map **E-mail 1 - Value** to email (auto-detected when present).

## After import

- Assign **groups** on the review step to target segments when sending.
- Check **Investors** directory counts and fix invalid rows by re-exporting a smaller file if needed.
