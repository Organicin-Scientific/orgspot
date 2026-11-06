import { sendTestEmail } from "@/server/campaigns/test-send";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { testSendInput } from "@/server/http/schemas";

export const maxDuration = 60;

export const POST = withAdmin<{ id: string }>(
  async ({ req, params, session }) => {
    const { recipients } = await readJson(req, testSendInput);
    return ok(await sendTestEmail(params.id, recipients, session.email));
  },
  { rateLimit: "testSend" },
);
