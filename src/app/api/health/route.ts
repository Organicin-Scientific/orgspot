import { aiDraftConfigured } from "@/server/ai/config";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness and config flags (no secrets). */
export async function GET() {
  const e = env();
  return Response.json(
    {
      ok: true,
      appEnv: e.APP_ENV,
      vercelEnv: e.VERCEL_ENV ?? null,
      liveSending: e.liveSending,
      aiDraft: aiDraftConfigured(),
      usesEmulators: e.usesEmulators,
      firebaseProjectId: e.FIREBASE_PROJECT_ID,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
