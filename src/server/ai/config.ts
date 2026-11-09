import "server-only";
import { env } from "../env";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_VERTEX_LOCATION = "us-central1";

export function vertexServiceAccount(): { client_email: string; private_key: string } | null {
  const e = env();
  const client_email = e.FIREBASE_CLIENT_EMAIL?.trim();
  const private_key = e.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!client_email || !private_key) return null;
  return { client_email, private_key };
}

export function aiDraftConfigured(): boolean {
  return env().AI_DRAFT_ENABLED && vertexServiceAccount() !== null;
}
