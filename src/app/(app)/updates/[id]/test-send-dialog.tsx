"use client";

import { useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";

interface TestResult {
  results: { to: string; ok: boolean; error?: string }[];
  sandbox: boolean;
}

export function TestSendDialog({
  open,
  onOpenChange,
  updateId,
  defaultEmail,
  liveSending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  updateId: string;
  defaultEmail: string;
  liveSending: boolean;
}) {
  const [value, setValue] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const close = (o: boolean) => {
    if (busy) return;
    if (!o) setResult(null);
    onOpenChange(o);
  };

  const recipients = value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function send() {
    setBusy(true);
    try {
      const res = await api<TestResult>(`/api/updates/${updateId}/test`, { body: { recipients } });
      setResult(res);
      const okCount = res.results.filter((r) => r.ok).length;
      if (okCount) toast.success(res.sandbox ? `Test recorded in sandbox (${okCount})` : `Test sent to ${okCount} address${okCount === 1 ? "" : "es"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test</DialogTitle>
          <DialogDescription>
            Sends the current saved version, marked “[TEST]”, only to the addresses below. Investors are never included.
          </DialogDescription>
        </DialogHeader>
        {!liveSending && (
          <Alert>
            <FlaskConical />
            <AlertDescription>Sandbox mode: the test is rendered and recorded, but no email is delivered.</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="test-recipients">Recipients</Label>
          <Textarea id="test-recipients" rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="you@company.com" />
          <p className="text-xs text-muted-foreground">Up to 5 addresses, separated by commas.</p>
        </div>
        {result && (
          <ul className="space-y-1 text-sm">
            {result.results.map((r) => (
              <li key={r.to} className="flex items-center gap-2">
                {r.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
                <span className="truncate">{r.to}</span>
                {!r.ok && <span className="text-xs text-muted-foreground">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Close
          </Button>
          <Button onClick={send} disabled={busy || recipients.length === 0 || recipients.length > 5}>
            {busy && <Loader2 className="animate-spin" />}
            Send test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
