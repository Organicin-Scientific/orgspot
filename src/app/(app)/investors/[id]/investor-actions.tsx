"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import type { Investor, InvestorGroup } from "@/lib/types";
import { InvestorFormSheet } from "../investor-form";

export function InvestorActions({
  investor,
  groups,
  categories,
  suppressed,
}: {
  investor: Investor;
  groups: InvestorGroup[];
  categories: string[];
  suppressed: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "suppress" | "unsuppress" | null>(null);

  async function act() {
    try {
      if (confirm === "delete") {
        await api(`/api/investors/${investor.id}`, { method: "DELETE" });
        toast.success("Investor deleted");
        router.push("/investors");
        return;
      }
      if (confirm === "suppress") {
        await api(`/api/investors/${investor.id}`, { method: "PATCH", body: { status: "suppressed" } });
        toast.success("Contact suppressed");
      }
      if (confirm === "unsuppress") {
        await api("/api/suppression", { method: "DELETE", body: { email: investor.email, confirm: true } });
        toast.success("Removed from suppression list");
      }
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      {suppressed ? (
        <Button variant="outline" size="sm" onClick={() => setConfirm("unsuppress")}>
          Re-subscribe
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirm("suppress")}>
          <Ban /> Suppress
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => setConfirm("delete")}>
        <Trash2 /> Delete
      </Button>
      <Button size="sm" onClick={() => setEditing(true)}>
        <Pencil /> Edit
      </Button>
      <InvestorFormSheet
        open={editing}
        onOpenChange={setEditing}
        investor={investor}
        groups={groups}
        categories={categories}
        onSaved={() => router.refresh()}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "delete" ? "Delete investor" : confirm === "suppress" ? "Suppress contact" : "Re-subscribe contact"}
        description={
          confirm === "delete"
            ? "This permanently deletes the contact. Their past send history is kept for reporting."
            : confirm === "suppress"
              ? "This address will be added to the suppression list and will not receive future updates."
              : "Only re-subscribe someone who has explicitly asked to receive updates again. The address will be removed from the suppression list and the contact reactivated."
        }
        confirmLabel={confirm === "delete" ? "Delete" : confirm === "suppress" ? "Suppress" : "Re-subscribe"}
        destructive={confirm !== "unsuppress"}
        onConfirm={act}
      />
    </>
  );
}
