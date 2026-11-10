#!/usr/bin/env bash
# Enable Vertex AI for orgspot template drafting on the Firebase/GCP project.
# Usage: ./scripts/enable-vertex-ai-draft.sh <project-id> <service-account-email>
set -euo pipefail

PROJECT="${1:?Usage: $0 <gcp-project-id> <firebase-admin-service-account-email>}"
SA_EMAIL="${2:?Usage: $0 <gcp-project-id> <firebase-admin-service-account-email>}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

gcloud config set project "$PROJECT"
gcloud services enable aiplatform.googleapis.com --project="$PROJECT"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user"

echo "Done. Set AI_DRAFT_ENABLED=true on Vercel production (if not already) and redeploy."
