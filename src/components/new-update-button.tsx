"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";

export function NewUpdateButton({ label = "New update", variant = "default" }: { label?: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const u = await api<{ id: string }>("/api/updates", { method: "POST", body: {} });
      router.push(`/updates/${u.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <Button onClick={create} disabled={creating} variant={variant} className="pressable">
      <Plus />
      {creating ? "Creating…" : label}
    </Button>
  );
}
