"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Monitor, Smartphone } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api-client";
import type { DocNode } from "@/lib/content/schema";
import { formatBytes } from "@/lib/format";
import type { SenderSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Meta } from "./editor-sidebar";

interface PreviewResult {
  html: string;
  text: string;
  sizeBytes: number;
  clipped: boolean;
  sender: SenderSnapshot;
  readiness: { ready: boolean; problems: string[] };
}

type View = "desktop" | "mobile" | "pdf" | "text";

export function PreviewDialog({
  open,
  onOpenChange,
  updateId,
  meta,
  getContent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  updateId: string;
  meta: Meta;
  getContent: () => DocNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92svh] max-w-[min(1100px,96vw)] flex-col gap-0 p-0 sm:max-w-[min(1100px,96vw)]">
        <PreviewBody updateId={updateId} meta={meta} getContent={getContent} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening renders a fresh preview. */
function PreviewBody({ updateId, meta, getContent }: { updateId: string; meta: Meta; getContent: () => DocNode }) {
  const [view, setView] = useState<View>("desktop");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNonce] = useState(() => Date.now());

  useEffect(() => {
    const ctrl = new AbortController();
    api<PreviewResult>(`/api/updates/${updateId}/preview`, { body: { ...meta, content: getContent() }, signal: ctrl.signal })
      .then(setResult)
      .catch((err) => !ctrl.signal.aborted && setError(errorMessage(err)));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateId]);

  return (
    <>
        <DialogHeader className="border-b px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate">{meta.subject || "No subject yet"}</DialogTitle>
              <DialogDescription className="truncate">
                {result ? `From ${result.sender.fromName || "—"} <${result.sender.fromEmail || "not configured"}>` : "Rendering the exact email investors will receive…"}
              </DialogDescription>
            </div>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="desktop">
                  <Monitor /> Desktop
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone /> Mobile
                </TabsTrigger>
                <TabsTrigger value="pdf">PDF</TabsTrigger>
                <TabsTrigger value="text">Plain text</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/50">
          {error && (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}
          {!error && view === "pdf" && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b bg-background px-4 py-2 text-xs text-muted-foreground">
                <span>PDF of the last saved version{meta.pdfDelivery === "none" ? " · not included with this update" : ""}</span>
                <Button asChild variant="ghost" size="xs">
                  <a href={`/api/updates/${updateId}/pdf?download=1`}>
                    <Download /> Download
                  </a>
                </Button>
              </div>
              <iframe title="PDF preview" src={`/api/updates/${updateId}/pdf?v=${pdfNonce}`} className="min-h-0 flex-1 bg-white" />
            </div>
          )}
          {!error && view !== "pdf" && !result && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!error && result && (view === "desktop" || view === "mobile") && (
            <div className="space-y-3 p-4">
              {result.clipped && (
                <Alert>
                  <AlertTriangle />
                  <AlertDescription>
                    This email is {formatBytes(result.sizeBytes)}. Gmail clips messages over 102 KB, so recipients would need to click “View entire message”. Shorten the update or remove images.
                  </AlertDescription>
                </Alert>
              )}
              <div className={cn("mx-auto overflow-hidden rounded-lg border bg-white shadow-sm transition-[width]", view === "mobile" ? "w-[390px]" : "w-full max-w-[760px]")}>
                <iframe
                  title="Email preview"
                  srcDoc={result.html}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  className="block h-[72svh] w-full bg-white"
                />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Size {formatBytes(result.sizeBytes)} · Personal links (unsubscribe, downloads) are shown as samples.
              </p>
            </div>
          )}
          {!error && result && view === "text" && (
            <pre className="mx-auto my-4 max-w-[760px] whitespace-pre-wrap rounded-lg border bg-background p-6 font-mono text-xs leading-relaxed">{result.text}</pre>
          )}
        </div>
    </>
  );
}
