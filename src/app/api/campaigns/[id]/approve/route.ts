import { after } from "next/server";
import { approveCampaign } from "@/server/campaigns/approve";
import { triggerWorkerContinuation } from "@/server/campaigns/continuation";
import { drainSendQueue } from "@/server/campaigns/worker";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { approveInput } from "@/server/http/schemas";
import { log } from "@/server/logger";

export const maxDuration = 60;

/**
 * The single, explicit "Confirm and Send" action. The client must echo the snapshot hash it
 * reviewed; if anything changed since review the approval is rejected.
 */
export const POST = withAdmin<{ id: string }>(
  async ({ req, params, session }) => {
    const { snapshotHash } = await readJson(req, approveInput);
    const result = await approveCampaign(params.id, snapshotHash, session.email);
    after(async () => {
      try {
        const run = await drainSendQueue(50_000);
        // Lists larger than one invocation can send continue in a fresh invocation.
        if (run.remaining) await triggerWorkerContinuation(0);
      } catch (err) {
        log.error("worker.after_approve_failed", { err });
      }
    });
    return ok(result);
  },
  { rateLimit: "campaign" },
);
