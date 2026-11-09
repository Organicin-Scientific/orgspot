"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ImagePlus, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import type { AppSettings, AssetMeta } from "@/lib/types";

interface Context {
  environment: string;
  liveSending: boolean;
  provider: string;
  configuredSenderEmail: string | null;
  storageNotice: string | null;
}

interface DomainResponse {
  configured: boolean;
  provider?: string;
  status: {
    domain: string;
    found: boolean;
    status: string;
    verified: boolean;
    records: { record: string; type: string; name: string; value: string; status: string }[];
    openTracking: boolean | null;
    clickTracking: boolean | null;
    error?: string;
  } | null;
}

const FONTS = [
  ["helvetica", "Helvetica / Arial"],
  ["georgia", "Georgia (serif)"],
  ["verdana", "Verdana"],
  ["trebuchet", "Trebuchet MS"],
] as const;

type Form = Omit<AppSettings, "updatedAt" | "updatedBy">;

export function SettingsForm({
  initial,
  initialReadiness,
  context,
}: {
  initial: AppSettings;
  initialReadiness: { ready: boolean; problems: string[] };
  context: Context;
}) {
  const [form, setForm] = useState<Form>({
    branding: initial.branding,
    sender: initial.sender,
    postalAddress: initial.postalAddress,
    footerNote: initial.footerNote,
  });
  const [readiness, setReadiness] = useState(initialReadiness);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const setBranding = (patch: Partial<Form["branding"]>) => {
    setForm((f) => ({ ...f, branding: { ...f.branding, ...patch } }));
    setDirty(true);
  };
  const setSender = (patch: Partial<Form["sender"]>) => {
    setForm((f) => ({ ...f, sender: { ...f.sender, ...patch } }));
    setDirty(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api<{ settings: AppSettings; readiness: typeof readiness }>("/api/settings", { method: "PUT", body: form });
      setReadiness(res.readiness);
      setDirty(false);
      toast.success("Settings saved");
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as { path: string; message: string }[]) map[d.path] = d.message;
        setErrors(map);
      }
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", "image");
      const asset = await api<AssetMeta>("/api/assets", { form: fd });
      setBranding({ logoAssetId: asset.id });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Branding and sender details used in every update." />
      <PageBody className="max-w-4xl">
        {context.storageNotice && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>File uploads are unavailable</AlertTitle>
            <AlertDescription>{context.storageNotice}</AlertDescription>
          </Alert>
        )}

        {!readiness.ready && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Sending is blocked until these are fixed</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {readiness.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={save} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sender</CardTitle>
              <CardDescription>
                Use an address on your dedicated sending subdomain (for example updates@updates.yourcompany.com) so investor mail never affects your main
                domain’s reputation.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Sender name" error={errors["sender.fromName"]}>
                <Input value={form.sender.fromName} onChange={(e) => setSender({ fromName: e.target.value })} maxLength={100} />
              </Field>
              <Field
                label="Sender email"
                error={errors["sender.fromEmail"]}
                hint={context.configuredSenderEmail ? `Must use the domain of ${context.configuredSenderEmail}` : undefined}
              >
                <Input type="email" value={form.sender.fromEmail} onChange={(e) => setSender({ fromEmail: e.target.value })} />
              </Field>
              <Field label="Reply-to address" error={errors["sender.replyTo"]} hint="Where investor replies go, e.g. your IR inbox." className="sm:col-span-2">
                <Input type="email" value={form.sender.replyTo} onChange={(e) => setSender({ replyTo: e.target.value })} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Branding</CardTitle>
              <CardDescription>Applied to the email, the PDF and the editor page.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" error={errors["branding.companyName"]}>
                <Input value={form.branding.companyName} onChange={(e) => setBranding({ companyName: e.target.value })} maxLength={120} />
              </Field>
              <Field label="Font">
                <Select value={form.branding.fontFamily} onValueChange={(v) => setBranding({ fontFamily: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONTS.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <ColorField label="Brand colour" value={form.branding.primaryColor} onChange={(v) => setBranding({ primaryColor: v })} error={errors["branding.primaryColor"]} />
              <ColorField label="Text colour" value={form.branding.textColor} onChange={(v) => setBranding({ textColor: v })} error={errors["branding.textColor"]} />
              <div className="space-y-2 sm:col-span-2">
                <Label>Logo</Label>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadLogo(f);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-48 items-center justify-center rounded-md border bg-white p-2">
                    {form.branding.logoAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/assets/${form.branding.logoAssetId}`} alt="Logo" className="max-h-full max-w-full" />
                    ) : (
                      <span className="text-sm font-bold" style={{ color: form.branding.primaryColor }}>
                        {form.branding.companyName}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => logoInput.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} {form.branding.logoAssetId ? "Replace" : "Upload"}
                    </Button>
                    {form.branding.logoAssetId && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setBranding({ logoAssetId: null })}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">PNG or JPEG, ideally at least 400 px wide. Without a logo, the company name is shown.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Footer</CardTitle>
              <CardDescription>A physical postal address is legally required in commercial email and is shown in every update.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Postal address" error={errors.postalAddress}>
                <Textarea
                  rows={2}
                  value={form.postalAddress}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, postalAddress: e.target.value }));
                    setDirty(true);
                  }}
                  maxLength={300}
                />
              </Field>
              <Field label="Footer note" hint="Optional, e.g. why the recipient is receiving this email or a confidentiality notice.">
                <Textarea
                  rows={2}
                  value={form.footerNote}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, footerNote: e.target.value }));
                    setDirty(true);
                  }}
                  maxLength={400}
                />
              </Field>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur">
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <Loader2 className="animate-spin" />}
              Save settings
            </Button>
          </div>
        </form>

        <DomainCard context={context} />
      </PageBody>
    </>
  );
}

function DomainCard({ context }: { context: Context }) {
  const [data, setData] = useState<DomainResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setData(await api<DomainResponse>("/api/settings/domain"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api<DomainResponse>("/api/settings/domain")
      .then(setData)
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const st = data?.status;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Email delivery</CardTitle>
          <CardDescription>
            Environment: <Badge variant="outline">{context.environment}</Badge>{" "}
            {context.liveSending ? (
              <Badge className="bg-success/15 text-success">Live sending enabled</Badge>
            ) : (
              <Badge variant="secondary">Sandbox — no email is delivered</Badge>
            )}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} /> Check
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading && !data ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : !data?.configured || !st ? (
          <p className="text-muted-foreground">Save a sender email to check its domain.</p>
        ) : st.error ? (
          <p className="text-muted-foreground">{st.error}</p>
        ) : !st.found ? (
          <p>
            <span className="font-medium">{st.domain}</span> is not set up with the email provider yet. Add it in Resend and publish the DNS records it gives
            you.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {st.verified ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-warning" />}
              <span className="font-medium">{st.domain}</span>
              <span className="text-muted-foreground">{st.verified ? "verified" : st.status.replace(/_/g, " ")}</span>
            </div>
            {st.records.length > 0 && (
              <ul className="divide-y rounded-md border">
                {st.records.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    {r.status === "verified" ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
                    <span className="w-16 font-medium">{r.record}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {r.type} {r.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Open tracking: {st.openTracking === null ? "unknown" : st.openTracking ? "on" : "off"} · Click tracking:{" "}
              {st.clickTracking === null ? "unknown" : st.clickTracking ? "on" : "off"}. Tracking is configured on the domain in Resend. Also publish a DMARC
              record (for example <code className="font-mono">v=DMARC1; p=none; rua=mailto:…</code>) on the sending subdomain.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="space-y-1.5">
        <Label>{label}</Label>
        {children}
        {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} error={error}>
      <div className="flex gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
          aria-label={`${label} picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="font-mono" />
      </div>
    </Field>
  );
}
