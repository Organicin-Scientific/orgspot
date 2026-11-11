"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Download, Loader2, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, postForFile, saveBlob } from "@/lib/api-client";
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
type PdfFile = { blob: Blob; url: string; filename: string };

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
  // Snapshot the editor once per opening, so the email, PDF and downloads all show the same version.
  const [content] = useState(getContent);
  const [pdf, setPdf] = useState<PdfFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const pdfRequest = useRef<Promise<PdfFile> | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api<PreviewResult>(`/api/updates/${updateId}/preview`, { body: { ...meta, content }, signal: ctrl.signal })
      .then(setResult)
      .catch((err) => !ctrl.signal.aborted && setError(errorMessage(err)));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateId]);

  /** Render the PDF from the same snapshot once; the tab and the Download menu share it. */
  const loadPdf = useCallback(() => {
    pdfRequest.current ??= postForFile(`/api/updates/${updateId}/pdf`, { ...meta, content }).then(({ blob, filename }) => {
      const file = { blob, url: URL.createObjectURL(blob), filename: filename ?? `${fileBase(meta.title)}.pdf` };
      setPdf(file);
      return file;
    });
    pdfRequest.current.catch((err) => {
      pdfRequest.current = null;
      setPdfError(errorMessage(err));
    });
    return pdfRequest.current;
  }, [updateId, meta, content]);

  useEffect(() => {
    if (view === "pdf") void loadPdf().catch(() => {});
  }, [view, loadPdf]);
  useEffect(() => () => void (pdf && URL.revokeObjectURL(pdf.url)), [pdf]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const file = await loadPdf();
      saveBlob(file.blob, file.filename);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  function downloadText(body: string, type: string, ext: string) {
    saveBlob(new Blob([body], { type: `${type};charset=utf-8` }), `${fileBase(meta.title)}.${ext}`);
  }

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
            <div className="flex items-center gap-2">
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={downloading}>
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void downloadPdf()}>PDF</DropdownMenuItem>
                <DropdownMenuItem disabled={!result} onSelect={() => result && downloadText(result.html, "text/html", "html")}>
                  Email (HTML)
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!result} onSelect={() => result && downloadText(result.text, "text/plain", "txt")}>
                  Plain text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
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
              {meta.pdfDelivery === "none" && (
                <div className="border-b bg-background px-4 py-2 text-xs text-muted-foreground">This PDF isn&apos;t included with this update.</div>
              )}
              {pdfError ? (
                <div className="p-6">
                  <Alert variant="destructive">
                    <AlertDescription>{pdfError}</AlertDescription>
                  </Alert>
                </div>
              ) : pdf ? (
                <iframe title="PDF preview" src={pdf.url} className="min-h-0 flex-1 bg-white" />
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
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

/** File name stem from the update title, matching the server's PDF naming. */
function fileBase(title: string): string {
  const base = title
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return base || "investor-update";
}
