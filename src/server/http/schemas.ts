import "server-only";
import { z } from "zod";
import { isValidEmail } from "@/lib/email-address";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS } from "@/lib/import";
import { INVESTOR_STATUSES, PDF_DELIVERY, UPDATE_STATUSES } from "@/lib/types";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const email = z
  .string()
  .trim()
  .max(254)
  .refine(isValidEmail, "Enter a valid email address");
const text = (max: number) => z.string().trim().max(max);

export const investorInput = z.object({
  firstName: text(100).default(""),
  lastName: text(100).default(""),
  email,
  organization: text(200).default(""),
  category: text(80).default(""),
  notes: z.string().max(2000).default(""),
  groupIds: z.array(id).max(50).default([]),
});

export const investorPatch = z.object({
  firstName: text(100).optional(),
  lastName: text(100).optional(),
  email: email.optional(),
  organization: text(200).optional(),
  category: text(80).optional(),
  notes: z.string().max(2000).optional(),
  groupIds: z.array(id).max(50).optional(),
  status: z.literal("suppressed").optional(),
});

export const investorListQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(INVESTOR_STATUSES).optional(),
  category: z.string().max(80).optional(),
  groupId: id.optional(),
  cursor: z.string().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const bulkInput = z.object({
  ids: z.array(id).min(1).max(1000),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("addToGroup"), groupId: id }),
    z.object({ type: z.literal("removeFromGroup"), groupId: id }),
    z.object({ type: z.literal("suppress") }),
    z.object({ type: z.literal("delete") }),
  ]),
});

export const groupInput = z.object({
  name: text(80).min(1, "Name is required"),
  description: text(300).default(""),
});
export const groupPatch = groupInput.partial();

export const suppressionInput = z.object({ email, reason: z.literal("manual").default("manual") });
export const suppressionRemove = z.object({ email, confirm: z.literal(true) });

const mapping = z.record(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(49)).refine(
  (m) => m.email !== undefined,
  "Map a column to Email address",
);
const importRows = z.array(z.array(z.string().max(5000)).max(50)).max(MAX_IMPORT_ROWS);

export const importPreviewInput = z.object({ rows: importRows, mapping });
export const importCommitInput = z.object({
  rows: importRows,
  mapping,
  duplicateStrategy: z.enum(["skip", "fill_empty"]),
  groupIds: z.array(id).max(20).default([]),
  confirm: z.literal(true),
});

export const updateSave = z.object({
  expectedVersion: z.number().int().min(1),
  title: text(200).optional(),
  subject: text(200).optional(),
  previewText: text(250).optional(),
  content: z.unknown().optional(),
  bannerAssetId: id.nullable().optional(),
  attachmentIds: z.array(id).max(10).optional(),
  pdfDelivery: z.enum(PDF_DELIVERY).optional(),
  revision: z.enum(["manual", "autosave"]).optional(),
});

export const updateListQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(UPDATE_STATUSES).optional(),
  cursor: z.string().max(600).optional(),
});

export const restoreInput = z.object({ revisionId: id, expectedVersion: z.number().int().min(1) });

export const testSendInput = z.object({
  recipients: z.array(email).min(1, "Enter at least one address").max(5, "Up to 5 test recipients"),
});

export const prepareInput = z.object({
  groupIds: z.array(id).max(50).default([]),
  allActive: z.boolean().default(false),
});

export const approveInput = z.object({
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirm: z.literal(true),
});

export const previewInput = z.object({
  title: text(200).default(""),
  subject: text(200).default(""),
  previewText: text(250).default(""),
  content: z.unknown(),
  bannerAssetId: id.nullable().default(null),
  attachmentIds: z.array(id).max(10).default([]),
  pdfDelivery: z.enum(PDF_DELIVERY).default("attach"),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour");
export const settingsInput = z.object({
  branding: z.object({
    companyName: text(120).min(1),
    logoAssetId: id.nullable(),
    primaryColor: hex,
    textColor: hex,
    fontFamily: z.enum(["helvetica", "georgia", "verdana", "trebuchet"]),
  }),
  sender: z.object({
    fromName: text(100).min(1, "Sender name is required").refine((v) => !/[<>"\r\n]/.test(v), "Sender name contains invalid characters"),
    fromEmail: email,
    replyTo: z.union([email, z.literal("")]),
  }),
  postalAddress: text(300),
  footerNote: text(400),
});

export const blockInput = z.object({ name: text(80).min(1), content: z.unknown() });
