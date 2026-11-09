import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeEmail } from "@/lib/email-address";
import { mapRows, type ColumnMapping, type DuplicateStrategy, type ImportRecord, type ImportSummary } from "@/lib/import";
import type { SuppressionReason } from "@/lib/types";
import { audit } from "../audit";
import { chunk } from "../db/convert";
import { groupsCol, investorsCol, rememberCategories, searchTokens, sortKey } from "../db/investors";
import { emailGuardCol, statusForReason, suppressedSet } from "../db/suppression";
import { db } from "../firebase-admin";
import { badRequest } from "../http/errors";

export interface PreviewRow {
  row: number;
  email: string;
  name: string;
  organization: string;
  category: string;
  outcome: "new" | "existing" | "invalid" | "duplicate_in_file";
  note: string;
}

export interface ImportPreview {
  counts: { new: number; existing: number; invalid: number; duplicateInFile: number; suppressed: number };
  rows: PreviewRow[];
}

async function existingByEmail(records: ImportRecord[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keys = records.map((r) => normalizeEmail(r.email));
  for (const part of chunk(keys, 300)) {
    const snaps = await db().getAll(...part.map((k) => emailGuardCol().doc(k)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.get("investorId") as string);
  }
  return out;
}

export async function previewImport(rows: string[][], mapping: ColumnMapping): Promise<ImportPreview> {
  if (mapping.email === undefined) throw badRequest("Map a column to Email address");
  const outcomes = mapRows(rows, mapping);
  const valid = outcomes.flatMap((o) => (o.kind === "valid" ? [o.record] : []));
  const existing = await existingByEmail(valid);
  const suppressed = await suppressedSet(valid.map((v) => v.email));
  const counts = { new: 0, existing: 0, invalid: 0, duplicateInFile: 0, suppressed: 0 };
  const preview: PreviewRow[] = outcomes.map((o) => {
    if (o.kind === "invalid") {
      counts.invalid++;
      return { row: o.row, email: o.email, name: "", organization: "", category: "", outcome: "invalid", note: o.reason };
    }
    if (o.kind === "duplicate_in_file") {
      counts.duplicateInFile++;
      return { row: o.row, email: o.email, name: "", organization: "", category: "", outcome: "duplicate_in_file", note: `Same email as row ${o.firstRow}` };
    }
    const r = o.record;
    const key = normalizeEmail(r.email);
    const isExisting = existing.has(key);
    const sup = suppressed.get(key);
    if (isExisting) counts.existing++;
    else counts.new++;
    if (sup && !isExisting) counts.suppressed++;
    return {
      row: r.row,
      email: r.email,
      name: `${r.firstName} ${r.lastName}`.trim(),
      organization: r.organization,
      category: r.category,
      outcome: isExisting ? "existing" : "new",
      note: isExisting ? "Already in the directory" : sup ? `Will be imported as ${statusForReason(sup)} (on suppression list)` : "",
    };
  });
  return { counts, rows: preview };
}

const FILLABLE = ["firstName", "lastName", "organization", "category", "notes"] as const;

/**
 * Import contacts. New contacts are created with email guards in the same transaction; existing
 * contacts are never overwritten — with `fill_empty` only blank fields are filled and the
 * selected groups added.
 */
export async function commitImport(
  rows: string[][],
  mapping: ColumnMapping,
  strategy: DuplicateStrategy,
  groupIds: string[],
  actor: string,
): Promise<ImportSummary> {
  if (mapping.email === undefined) throw badRequest("Map a column to Email address");
  const groups = [...new Set(groupIds)];
  if (groups.length) {
    const snaps = await db().getAll(...groups.map((g) => groupsCol().doc(g)));
    if (snaps.some((s) => !s.exists)) throw badRequest("One or more selected groups no longer exist");
  }
  const outcomes = mapRows(rows, mapping);
  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skippedExisting: 0,
    duplicateInFile: outcomes.filter((o) => o.kind === "duplicate_in_file").length,
    invalid: outcomes.filter((o) => o.kind === "invalid").length,
    suppressedOnImport: 0,
  };
  const valid = outcomes.flatMap((o) => (o.kind === "valid" ? [o.record] : []));
  const suppressed = await suppressedSet(valid.map((v) => v.email));

  for (const part of chunk(valid, 100)) {
    const delta = await db().runTransaction(async (tx) => {
      const guardRefs = part.map((r) => emailGuardCol().doc(normalizeEmail(r.email)));
      const guards = await tx.getAll(...guardRefs);
      const existingRefs = guards.filter((g) => g.exists).map((g) => investorsCol().doc(g.get("investorId") as string));
      const existingSnaps = strategy === "fill_empty" && existingRefs.length ? await tx.getAll(...existingRefs) : [];
      const existingById = new Map(existingSnaps.filter((s) => s.exists).map((s) => [s.id, s]));
      const d = { created: 0, updated: 0, skipped: 0, suppressed: 0, groupAdds: new Map<string, number>() };

      part.forEach((rec, i) => {
        const guard = guards[i];
        if (guard.exists) {
          const snap = existingById.get(guard.get("investorId") as string);
          if (strategy !== "fill_empty" || !snap) {
            d.skipped++;
            return;
          }
          const patch: Record<string, unknown> = {};
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          for (const f of FILLABLE) {
            if (!String(snap.get(f) ?? "").trim() && rec[f]) {
              patch[f] = rec[f];
              changes[f] = { from: "", to: rec[f] };
            }
          }
          const currentGroups = (snap.get("groupIds") as string[]) ?? [];
          const addGroups = groups.filter((g) => !currentGroups.includes(g));
          if (addGroups.length) {
            patch.groupIds = FieldValue.arrayUnion(...addGroups);
            changes.groups = { from: currentGroups, to: [...currentGroups, ...addGroups] };
            for (const g of addGroups) d.groupAdds.set(g, (d.groupAdds.get(g) ?? 0) + 1);
          }
          if (!Object.keys(patch).length) {
            d.skipped++;
            return;
          }
          const merged = {
            firstName: (patch.firstName as string) ?? (snap.get("firstName") as string) ?? "",
            lastName: (patch.lastName as string) ?? (snap.get("lastName") as string) ?? "",
            organization: (patch.organization as string) ?? (snap.get("organization") as string) ?? "",
            email: snap.get("email") as string,
          };
          tx.update(snap.ref, {
            ...patch,
            searchTokens: searchTokens(merged),
            sortKey: sortKey(merged, snap.id),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.create(snap.ref.collection("history").doc(), { at: FieldValue.serverTimestamp(), actor, changes, source: "import" });
          d.updated++;
          return;
        }
        const ref = investorsCol().doc();
        const sup = suppressed.get(normalizeEmail(rec.email));
        if (sup) d.suppressed++;
        tx.create(guardRefs[i], { investorId: ref.id });
        tx.create(ref, {
          firstName: rec.firstName,
          lastName: rec.lastName,
          email: rec.email,
          emailNormalized: normalizeEmail(rec.email),
          organization: rec.organization,
          category: rec.category,
          notes: rec.notes,
          groupIds: groups,
          status: sup ? statusForReason(sup as SuppressionReason) : "active",
          searchTokens: searchTokens(rec),
          sortKey: sortKey(rec, ref.id),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: actor,
        });
        tx.create(ref.collection("history").doc(), {
          at: FieldValue.serverTimestamp(),
          actor,
          changes: { created: { from: null, to: "import" } },
        });
        for (const g of groups) d.groupAdds.set(g, (d.groupAdds.get(g) ?? 0) + 1);
        d.created++;
      });
      for (const [g, n] of d.groupAdds) tx.update(groupsCol().doc(g), { memberCount: FieldValue.increment(n) });
      return d;
    });
    summary.created += delta.created;
    summary.updated += delta.updated;
    summary.skippedExisting += delta.skipped;
    summary.suppressedOnImport += delta.suppressed;
  }
  await rememberCategories(valid.map((v) => v.category));
  await audit({
    actorEmail: actor,
    action: "investor.import",
    resourceType: "investor",
    summary: `Imported contacts: ${summary.created} created, ${summary.updated} updated, ${summary.skippedExisting} skipped, ${summary.invalid} invalid, ${summary.duplicateInFile} duplicate rows`,
  });
  return summary;
}
