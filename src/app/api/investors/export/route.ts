import { csvSafe } from "@/lib/import";
import { audit } from "@/server/audit";
import { iterateInvestors } from "@/server/db/investors";
import { listGroups } from "@/server/db/groups";
import { withAdmin } from "@/server/http/handler";

const HEADER = ["First name", "Last name", "Email", "Organization", "Category", "Status", "Groups", "Notes", "Created", "Updated"];

export const GET = withAdmin(
  async ({ req, session }) => {
    const groupId = req.nextUrl.searchParams.get("groupId") || undefined;
    const groups = new Map((await listGroups()).map((g) => [g.id, g.name]));
    const encoder = new TextEncoder();
    let count = 0;
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("\uFEFF" + HEADER.join(",") + "\r\n"));
        for await (const i of iterateInvestors({ groupId })) {
          const row = [
            i.firstName,
            i.lastName,
            i.email,
            i.organization,
            i.category,
            i.status,
            i.groupIds.map((g) => groups.get(g) ?? "").filter(Boolean).join("; "),
            i.notes,
            i.createdAt,
            i.updatedAt,
          ].map(csvSafe);
          controller.enqueue(encoder.encode(row.join(",") + "\r\n"));
          count++;
        }
        controller.close();
        await audit({
          actorEmail: session.email,
          action: "investor.export",
          resourceType: "investor",
          summary: `Exported ${count} contacts to CSV`,
        });
      },
    });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="investors-${date}.csv"`,
      },
    });
  },
  { rateLimit: "export" },
);
