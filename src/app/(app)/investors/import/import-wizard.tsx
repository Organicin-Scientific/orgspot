"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import {
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  type ColumnMapping,
  type DuplicateStrategy,
  type ImportField,
  type ImportSummary,
} from "@/lib/import";
import type { InvestorGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Parsed {
  headers: string[];
  rows: string[][];
  truncated: boolean;
  suggestedMapping: ColumnMapping;
}

interface PreviewRow {
  row: number;
  email: string;
  name: string;
  organization: string;
  category: string;
  outcome: "new" | "existing" | "invalid" | "duplicate_in_file";
  note: string;
}

interface Preview {
  counts: { new: number; existing: number; invalid: number; duplicateInFile: number; suppressed: number };
  rows: PreviewRow[];
}

const STEPS = ["Upload", "Map columns", "Review", "Done"] as const;
const NONE = "__none";

export function ImportWizard({ groups }: { groups: InvestorGroup[] }) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError("Choose a .csv or .xlsx file.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await api<Parsed>("/api/investors/import/parse", { form });
      setFileName(file.name);
      setParsed(res);
      setMapping(res.suggestedMapping);
      if (res.truncated) {
        setError(`This file has more than ${formatNumber(MAX_IMPORT_ROWS)} rows. Split it into smaller files and import each one.`);
        return;
      }
      setStep(1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api<Preview>("/api/investors/import/preview", { body: { rows: parsed.rows, mapping } }));
      setStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ImportSummary>("/api/investors/import/commit", {
        body: { rows: parsed.rows, mapping, duplicateStrategy: strategy, groupIds, confirm: true },
      });
      setSummary(res);
      setStep(3);
      toast.success("Import complete");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(0);
    setParsed(null);
    setPreview(null);
    setSummary(null);
    setMapping({});
    setGroupIds([]);
    setError(null);
  }

  return (
    <>
      <PageHeader title="Import investors" description="Upload a CSV or Excel export. Nothing is saved until you confirm.">
        <Link href="/investors" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> Investors
        </Link>
      </PageHeader>
      <PageBody className="max-w-5xl">
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Import progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                  i < step && "border-brand bg-brand text-brand-foreground",
                  i === step && "border-foreground",
                  i > step && "text-muted-foreground",
                )}
                aria-current={i === step ? "step" : undefined}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn(i === step ? "font-medium" : "text-muted-foreground")}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Can’t continue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === 0 && <UploadStep busy={busy} onFile={upload} />}

        {step === 1 && parsed && (
          <MappingStep
            parsed={parsed}
            fileName={fileName}
            mapping={mapping}
            setMapping={setMapping}
            busy={busy}
            onBack={reset}
            onNext={runPreview}
          />
        )}

        {step === 2 && preview && (
          <ReviewStep
            preview={preview}
            groups={groups}
            strategy={strategy}
            setStrategy={setStrategy}
            groupIds={groupIds}
            setGroupIds={setGroupIds}
            busy={busy}
            onBack={() => setStep(1)}
            onConfirm={commit}
          />
        )}

        {step === 3 && summary && (
          <Card>
            <CardHeader>
              <CardTitle>Import complete</CardTitle>
              <CardDescription>{fileName}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Contacts added" value={summary.created} />
                <Stat label="Existing contacts updated" value={summary.updated} />
                <Stat label="Existing contacts unchanged" value={summary.skippedExisting} />
                <Stat label="Invalid rows skipped" value={summary.invalid} muted />
                <Stat label="Duplicate rows in file" value={summary.duplicateInFile} muted />
                <Stat label="Added as suppressed" value={summary.suppressedOnImport} muted />
              </div>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href="/investors">View investors</Link>
                </Button>
                <Button variant="outline" onClick={reset}>
                  Import another file
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function UploadStep({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
        drag && "border-brand bg-brand/5",
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <FileSpreadsheet className="size-5 text-muted-foreground" />}
      </div>
      <div>
        <p className="font-medium">Drop a spreadsheet here</p>
        <p className="text-sm text-muted-foreground">.csv or .xlsx, up to 4 MB and {formatNumber(MAX_IMPORT_ROWS)} rows. The first row must contain column headings.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button onClick={() => input.current?.click()} disabled={busy}>
        <Upload /> Choose file
      </Button>
    </div>
  );
}

function MappingStep({
  parsed,
  fileName,
  mapping,
  setMapping,
  busy,
  onBack,
  onNext,
}: {
  parsed: Parsed;
  fileName: string;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const sample = parsed.rows.slice(0, 3);
  const usedBy = useMemo(() => {
    const m = new Map<number, ImportField>();
    for (const f of IMPORT_FIELDS) if (mapping[f] !== undefined) m.set(mapping[f]!, f);
    return m;
  }, [mapping]);

  function assign(field: ImportField, value: string) {
    const next = { ...mapping };
    if (value === NONE) delete next[field];
    else {
      const col = Number(value);
      for (const f of IMPORT_FIELDS) if (next[f] === col) delete next[f];
      next[field] = col;
    }
    setMapping(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match your columns</CardTitle>
        <CardDescription>
          {fileName} · {formatNumber(parsed.rows.length)} rows. We matched what we could; check each field. Only Email address is required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="divide-y rounded-lg border">
          {IMPORT_FIELDS.map((field) => {
            const col = mapping[field];
            return (
              <div key={field} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[180px_240px_1fr]">
                <Label className="font-medium">
                  {IMPORT_FIELD_LABELS[field]}
                  {field === "email" && <span className="text-destructive"> *</span>}
                </Label>
                <Select value={col === undefined ? NONE : String(col)} onValueChange={(v) => assign(field, v)}>
                  <SelectTrigger aria-label={`Column for ${IMPORT_FIELD_LABELS[field]}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Don’t import</SelectItem>
                    {parsed.headers.map((h, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {h}
                        {usedBy.has(i) && usedBy.get(i) !== field ? ` (used for ${IMPORT_FIELD_LABELS[usedBy.get(i)!]})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="truncate text-xs text-muted-foreground">
                  {col === undefined ? "—" : sample.map((r) => r[col]).filter(Boolean).slice(0, 3).join(" · ") || "(empty in first rows)"}
                </div>
              </div>
            );
          })}
        </div>
        {mapping.fullName !== undefined && (mapping.firstName !== undefined || mapping.lastName !== undefined) && (
          <p className="text-xs text-muted-foreground">First and last name columns take priority over Full name when both are present.</p>
        )}
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Choose another file
          </Button>
          <Button onClick={onNext} disabled={busy || mapping.email === undefined}>
            {busy && <Loader2 className="animate-spin" />}
            Review import
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewStep({
  preview,
  groups,
  strategy,
  setStrategy,
  groupIds,
  setGroupIds,
  busy,
  onBack,
  onConfirm,
}: {
  preview: Preview;
  groups: InvestorGroup[];
  strategy: DuplicateStrategy;
  setStrategy: (s: DuplicateStrategy) => void;
  groupIds: string[];
  setGroupIds: (g: string[]) => void;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [tab, setTab] = useState<"all" | PreviewRow["outcome"]>("all");
  const rows = preview.rows.filter((r) => tab === "all" || r.outcome === tab);
  const { counts } = preview;
  const willChange = counts.new + (strategy === "fill_empty" ? counts.existing : 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="New contacts" value={counts.new} />
        <Stat label="Already in directory" value={counts.existing} />
        <Stat label="Invalid rows" value={counts.invalid} muted />
        <Stat label="Duplicates in file" value={counts.duplicateInFile} muted />
      </div>
      {counts.suppressed > 0 && (
        <Alert>
          <AlertTitle>{counts.suppressed} new contacts are on the suppression list</AlertTitle>
          <AlertDescription>They will be added but marked as unsubscribed or bounced, and will not receive updates.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Options</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <Label>Contacts that already exist</Label>
            <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as DuplicateStrategy)}>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="skip" className="mt-0.5" />
                <span>
                  <span className="font-medium">Leave unchanged</span>
                  <span className="block text-muted-foreground">Existing contacts are not modified.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="fill_empty" className="mt-0.5" />
                <span>
                  <span className="font-medium">Fill in blank fields</span>
                  <span className="block text-muted-foreground">Only empty fields are filled and selected groups added. Nothing is overwritten.</span>
                </span>
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-3">
            <Label>Add imported contacts to groups</Label>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No groups yet. <Link href="/investors/groups" className="underline">Create a group</Link> first if you want to assign one.
              </p>
            ) : (
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={groupIds.includes(g.id)}
                      onCheckedChange={(c) => setGroupIds(c ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id))}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Rows</CardTitle>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="new">New</TabsTrigger>
              <TabsTrigger value="existing">Existing</TabsTrigger>
              <TabsTrigger value="invalid">Invalid</TabsTrigger>
              <TabsTrigger value="duplicate_in_file">Duplicates</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="px-0">
          <div className="max-h-96 overflow-auto border-y">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="hidden md:table-cell">Name</TableHead>
                  <TableHead className="hidden lg:table-cell">Organization</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 500).map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                    <TableCell className="max-w-56 truncate">{r.email || <span className="text-muted-foreground">(blank)</span>}</TableCell>
                    <TableCell className="hidden max-w-40 truncate md:table-cell">{r.name || "—"}</TableCell>
                    <TableCell className="hidden max-w-40 truncate lg:table-cell">{r.organization || "—"}</TableCell>
                    <TableCell>
                      <span className={cn("text-xs", r.outcome === "invalid" && "text-destructive", r.outcome === "new" && "text-success")}>
                        {OUTCOME_LABEL[r.outcome]}
                        {r.note && <span className="block text-muted-foreground">{r.note}</span>}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {rows.length > 500 && <p className="px-6 pt-3 text-xs text-muted-foreground">Showing the first 500 of {formatNumber(rows.length)} rows.</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back to column mapping
        </Button>
        <Button onClick={onConfirm} disabled={busy || willChange === 0}>
          {busy && <Loader2 className="animate-spin" />}
          {willChange === 0
            ? "Nothing to import"
            : `Import ${formatNumber(counts.new)} new contact${counts.new === 1 ? "" : "s"}${strategy === "fill_empty" && counts.existing ? ` and update ${formatNumber(counts.existing)}` : ""}`}
        </Button>
      </div>
    </div>
  );
}

const OUTCOME_LABEL: Record<PreviewRow["outcome"], string> = {
  new: "Will be added",
  existing: "Already exists",
  invalid: "Invalid",
  duplicate_in_file: "Duplicate",
};

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", muted && value > 0 && "text-muted-foreground")}>{formatNumber(value)}</div>
    </div>
  );
}
