import "server-only";
import { env } from "../env";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
// Gemini 3.8 Flash is served from the global endpoint (and the us/eu multi-regions), not from
// single regions such as us-central1, which answer 404 "publisher model not found".
export const DEFAULT_VERTEX_LOCATION = "global";

export function vertexLocation(): string {
  return env().VERTEX_GEMINI_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
}

/**
 * The Vertex SDK builds its host as `<location>-aiplatform.googleapis.com`. The global
 * location has no prefixed host, so it needs the base endpoint passed explicitly.
 */
export function vertexApiEndpoint(location: string): string | undefined {
  return location === "global" ? "aiplatform.googleapis.com" : undefined;
}

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
