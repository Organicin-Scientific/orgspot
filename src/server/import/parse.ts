import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { MAX_IMPORT_ROWS } from "@/lib/import";
import { badRequest } from "../http/errors";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

function finalize(all: string[][]): ParsedSheet {
  const nonEmpty = all.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) throw badRequest("The spreadsheet is empty");
  const [header, ...body] = nonEmpty;
  const width = Math.min(Math.max(header.length, ...body.slice(0, 200).map((r) => r.length)), 50);
  const headers = Array.from({ length: width }, (_, i) => String(header[i] ?? "").trim() || `Column ${i + 1}`);
  const truncated = body.length > MAX_IMPORT_ROWS;
  const rows = body.slice(0, MAX_IMPORT_ROWS).map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? "").slice(0, 5000)));
  return { headers, rows, truncated };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlink
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result === undefined || v.result === null ? "" : String(v.result); // formula: value only
    if ("error" in v) return "";
  }
  return "";
}

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_IMPORT_BYTES) throw badRequest("Spreadsheets must be 4 MB or smaller");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    if (res.errors.length && res.data.length === 0) throw badRequest("Could not read the CSV file");
    return finalize(res.data);
  }

  if (name.endsWith(".xlsx")) {
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw badRequest("This file is not a valid .xlsx workbook");
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw badRequest("Could not read the Excel workbook");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest("The workbook has no worksheets");
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (all.length > MAX_IMPORT_ROWS + 1) return;
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        values[col - 1] = cellText(c.value);
      });
      all.push(Array.from(values, (v) => v ?? ""));
    });
    return finalize(all);
  }

  throw badRequest("Upload a .csv or .xlsx file");
}
