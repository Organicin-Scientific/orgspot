import { isValidEmail, normalizeEmail } from "./email-address";

export const IMPORT_FIELDS = ["email", "firstName", "lastName", "fullName", "organization", "category", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  email: "Email address",
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name (split automatically)",
  organization: "Organization / firm",
  category: "Investor category",
  notes: "Notes",
};

export const MAX_IMPORT_ROWS = 5000;

const SYNONYMS: Record<ImportField, string[]> = {
  email: ["email", "email address", "e-mail", "mail", "emailaddress", "primary email"],
  firstName: ["first name", "firstname", "first", "given name", "forename"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  fullName: ["name", "full name", "fullname", "contact name", "contact"],
  organization: ["organization", "organisation", "company", "firm", "fund", "company name", "org"],
  category: ["category", "type", "investor type", "segment", "tier", "lifecycle stage"],
  notes: ["notes", "note", "comments", "comment", "description"],
};

const clean = (h: string) => h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(clean(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  if (mapping.email === undefined) {
    const idx = headers.findIndex((h, i) => !used.has(i) && clean(h).includes("email"));
    if (idx >= 0) mapping.email = idx;
  }
  // A "name" column maps to fullName, but explicit first/last columns must win — mixing breaks preview/commit.
  if (mapping.firstName !== undefined || mapping.lastName !== undefined) delete mapping.fullName;
  return mapping;
}

export function splitFullName(full: string): { firstName: string; lastName: string } {
  const v = full.trim().replace(/\s+/g, " ");
  if (!v) return { firstName: "", lastName: "" };
  if (v.includes(",")) {
    const [last, first] = v.split(",").map((s) => s.trim());
    return { firstName: first ?? "", lastName: last ?? "" };
  }
  const parts = v.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export interface ImportRecord {
  row: number;
  email: string;
  firstName: string;
  lastName: string;
  organization: string;
  category: string;
  notes: string;
}

export type RowOutcome =
  | { kind: "valid"; record: ImportRecord }
  | { kind: "invalid"; row: number; email: string; reason: string }
  | { kind: "duplicate_in_file"; row: number; email: string; firstRow: number };

const cell = (row: string[], idx: number | undefined) =>
  idx === undefined ? "" : String(row[idx] ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();

export function sanitizeCell(v: string, max: number): string {
  return v.slice(0, max);
}

export function mapRows(rows: string[][], mapping: ColumnMapping): RowOutcome[] {
  const seen = new Map<string, number>();
  const out: RowOutcome[] = [];
  rows.forEach((r, i) => {
    const rowNumber = i + 2; // header is row 1 in the user's spreadsheet
    if (r.every((v) => String(v ?? "").trim() === "")) return;
    const rawEmail = cell(r, mapping.email);
    let firstName = cell(r, mapping.firstName);
    let lastName = cell(r, mapping.lastName);
    if (!firstName && !lastName && mapping.fullName !== undefined) {
      ({ firstName, lastName } = splitFullName(cell(r, mapping.fullName)));
    }
    if (!rawEmail) {
      out.push({ kind: "invalid", row: rowNumber, email: "", reason: "Missing email address" });
      return;
    }
    const email = rawEmail.replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim();
    if (!isValidEmail(email)) {
      out.push({ kind: "invalid", row: rowNumber, email: rawEmail.slice(0, 254), reason: "Invalid email address" });
      return;
    }
    const key = normalizeEmail(email);
    const first = seen.get(key);
    if (first !== undefined) {
      out.push({ kind: "duplicate_in_file", row: rowNumber, email, firstRow: first });
      return;
    }
    seen.set(key, rowNumber);
    out.push({
      kind: "valid",
      record: {
        row: rowNumber,
        email,
        firstName: sanitizeCell(firstName, 100),
        lastName: sanitizeCell(lastName, 100),
        organization: sanitizeCell(cell(r, mapping.organization), 200),
        category: sanitizeCell(cell(r, mapping.category), 80),
        notes: sanitizeCell(cell(r, mapping.notes), 2000),
      },
    });
  });
  return out;
}

export type DuplicateStrategy = "skip" | "fill_empty";

export interface ImportSummary {
  created: number;
  updated: number;
  skippedExisting: number;
  duplicateInFile: number;
  invalid: number;
  suppressedOnImport: number;
}

/** Prefix spreadsheet-formula characters so exported CSVs cannot execute in Excel/Sheets. */
export function csvSafe(value: string): string {
  const v = value ?? "";
  const escaped = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}
