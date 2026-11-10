# Drafting assistant (Vertex Gemini)

The **Assistant** tab in the update editor's right sidebar is a chat with Gemini. Admins paste notes, attach a PDF, Word or text document (4 MB max), or ask for changes, and Gemini writes into the update inside the standard template: it fills `[Write: …]` placeholders and can replace, insert or delete top-level blocks. The house voice rules live in `src/server/ai/voice.ts`.

Edits go straight into the document. The editor is read-only while a turn runs, and a manual revision is saved before and after each change, so History can restore the earlier version. The conversation is saved per update. Calls run **server-side only** through **Vertex AI** in the same GCP project as Firebase (`FIREBASE_PROJECT_ID`).

## Vercel (orgspot)

Production on the **orgspot** Vercel project should include:

| Variable | Value |
|----------|--------|
| `AI_DRAFT_ENABLED` | `true` |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `VERTEX_GEMINI_LOCATION` | `us-central1` |

No new secrets are required: the app reuses **`FIREBASE_CLIENT_EMAIL`** and **`FIREBASE_PRIVATE_KEY`** (same as Firestore Admin).

After changing env vars, **redeploy production** (merge the feature branch or trigger a redeploy) so the running build includes the AI draft API and editor UI.

## Firebase / GCP (`orgspot-afbf7`)

Run once per project (owner or `roles/owner` on the GCP project):

```bash
export GCP_PROJECT=orgspot-afbf7
export SA_EMAIL='your-firebase-adminsdk@orgspot-afbf7.iam.gserviceaccount.com'  # same as FIREBASE_CLIENT_EMAIL

gcloud config set project "$GCP_PROJECT"
gcloud services enable aiplatform.googleapis.com

gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user"
```

Or use the helper script:

```bash
./scripts/enable-vertex-ai-draft.sh orgspot-afbf7 'firebase-adminsdk-…@orgspot-afbf7.iam.gserviceaccount.com'
```

In [Google Cloud Console](https://console.cloud.google.com/):

1. **APIs & Services** → enable **Vertex AI API**
2. **IAM** → find the Firebase Admin SDK service account → add role **Vertex AI User**

## Verify

1. Open an editable update on production → the **Assistant** tab should accept messages.
2. Paste short quarter notes or attach a document and send. The document updates and the reply says what changed.
3. If it fails with permission errors, confirm IAM and that the model id `gemini-3.8-flash` is available in `us-central1`.

## Data handling

Messages and attached documents are sent to **Vertex Gemini** in your GCP project. Message text is stored in `updates/{id}/assistantMessages`; attached files are read once and not stored (only the file name is kept). The audit log records each turn without its content.
