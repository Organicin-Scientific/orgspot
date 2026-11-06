"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import type { Investor, InvestorGroup } from "@/lib/types";

type FormState = Pick<Investor, "firstName" | "lastName" | "email" | "organization" | "category" | "notes" | "groupIds">;

const EMPTY: FormState = { firstName: "", lastName: "", email: "", organization: "", category: "", notes: "", groupIds: [] };

export function InvestorFormSheet({
  open,
  onOpenChange,
  investor,
  groups,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investor?: Investor | null;
  groups: InvestorGroup[];
  categories: string[];
  onSaved: (investor: Investor) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<{ open: boolean; investor: Investor | null | undefined }>({ open: false, investor: null });

  // Start from a clean form each time the sheet opens (or is pointed at another contact).
  if (openedFor.open !== open || openedFor.investor !== investor) {
    setOpenedFor({ open, investor });
    if (open) {
      setForm(investor ? { ...investor } : EMPTY);
      setFieldError({});
    }
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFieldError({});
    try {
      const saved = investor
        ? await api<Investor>(`/api/investors/${investor.id}`, { method: "PATCH", body: form })
        : await api<Investor>("/api/investors", { method: "POST", body: form });
      toast.success(investor ? "Investor updated" : "Investor added");
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as { path: string; message: string }[]) map[d.path] = d.message;
        setFieldError(map);
      }
      if (err instanceof ApiError && err.code === "conflict") setFieldError({ email: err.message });
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{investor ? "Edit investor" : "Add investor"}</SheetTitle>
          <SheetDescription>
            {investor ? "Changes are recorded in the contact’s history." : "Add a single contact. Use Import for spreadsheets."}
          </SheetDescription>
        </SheetHeader>
        <form id="investor-form" onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto px-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" id="firstName">
              <Input id="firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
            </Field>
            <Field label="Last name" id="lastName">
              <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </Field>
          </div>
          <Field label="Email" id="email" error={fieldError.email}>
            <Input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              aria-invalid={!!fieldError.email}
            />
          </Field>
          <Field label="Organization" id="organization">
            <Input id="organization" value={form.organization} onChange={(e) => set("organization", e.target.value)} />
          </Field>
          <Field label="Category" id="category">
            <Input id="category" list="investor-categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Angel, VC" />
            <datalist id="investor-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          {groups.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Groups</legend>
              <div className="space-y-2 rounded-lg border p-3">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.groupIds.includes(g.id)}
                      onCheckedChange={(c) =>
                        set("groupIds", c ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id))
                      }
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label="Notes" id="notes">
            <Textarea id="notes" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
          </Field>
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="investor-form" disabled={busy || !form.email.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            {investor ? "Save changes" : "Add investor"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
