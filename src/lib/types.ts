import type { DocNode } from "./content/schema";

export const INVESTOR_STATUSES = ["active", "unsubscribed", "bounced", "suppressed"] as const;
export type InvestorStatus = (typeof INVESTOR_STATUSES)[number];

export const UPDATE_STATUSES = ["draft", "ready", "sending", "sent", "failed"] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  "pending_approval",
  "queued",
  "sending",
  "sent",
  "partially_failed",
  "failed",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RECIPIENT_STATUSES = [
  "queued",
  "sending",
  "retry_wait",
  "accepted",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
  "needs_review",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/** Stored on `suppressionList` docs. `hard_bounce` is legacy (use `bounce`). */
export const SUPPRESSION_REASONS = ["unsubscribe", "bounce", "hard_bounce", "complaint", "manual"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const PDF_DELIVERY = ["attach", "link", "none"] as const;
export type PdfDelivery = (typeof PDF_DELIVERY)[number];

export type ISODate = string;

export interface Investor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  category: string;
  status: InvestorStatus;
  groupIds: string[];
  notes: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface InvestorGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface UpdateDoc {
  id: string;
  title: string;
  subject: string;
  previewText: string;
  content: DocNode;
  bannerAssetId: string | null;
  attachmentIds: string[];
  pdfDelivery: PdfDelivery;
  status: UpdateStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  sentAt: ISODate | null;
  pendingCampaignId: string | null;
  sentCampaignId: string | null;
  duplicatedFrom: string | null;
}

export type UpdateSummary = Omit<UpdateDoc, "content">;

export interface UpdateRevision {
  id: string;
  updateId: string;
  title: string;
  subject: string;
  previewText: string;
  content: DocNode;
  version: number;
  reason: "manual" | "autosave" | "restore";
  createdBy: string;
  createdAt: ISODate;
}

export interface CampaignStats {
  selected: number;
  eligible: number;
  excluded: number;
  accepted: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  skipped: number;
  unsubscribed: number;
  opened: number;
  clicked: number;
}

export interface SenderSnapshot {
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

export interface Campaign {
  id: string;
  updateId: string;
  updateVersion: number;
  title: string;
  subject: string;
  previewText: string;
  sender: SenderSnapshot;
  audience: { groupIds: string[]; groupNames: string[]; allActive: boolean };
  pdfDelivery: PdfDelivery;
  snapshotHash: string;
  status: CampaignStatus;
  stats: CampaignStats;
  createdBy: string;
  createdAt: ISODate;
  approval: { approvedBy: string; approvedAt: ISODate } | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  cancelledAt: ISODate | null;
  lastError: string | null;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  investorId: string;
  email: string;
  firstName: string;
  lastName: string;
  organization: string;
  status: RecipientStatus;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  queuedAt: ISODate;
  acceptedAt: ISODate | null;
  deliveredAt: ISODate | null;
  bouncedAt: ISODate | null;
  complainedAt: ISODate | null;
  failedAt: ISODate | null;
  openedAt: ISODate | null;
  clickedAt: ISODate | null;
  unsubscribedAt: ISODate | null;
}

export interface ExcludedRecipient {
  investorId: string;
  name: string;
  email: string;
  reason: "unsubscribed" | "bounced" | "suppressed" | "suppression_list";
}

export interface EmailEvent {
  id: string;
  type: string;
  campaignId: string | null;
  recipientId: string | null;
  occurredAt: ISODate;
  receivedAt: ISODate;
  detail: string | null;
}

export interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  source: string;
  createdAt: ISODate;
}

export interface AuditLog {
  id: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  at: ISODate;
}

export interface Branding {
  companyName: string;
  logoAssetId: string | null;
  primaryColor: string;
  textColor: string;
  fontFamily: string;
}

export interface AppSettings {
  branding: Branding;
  sender: SenderSnapshot;
  postalAddress: string;
  footerNote: string;
  updatedAt: ISODate | null;
  updatedBy: string | null;
}

export interface ContentBlock {
  id: string;
  name: string;
  content: DocNode;
  createdAt: ISODate;
  createdBy: string;
}

export interface AssetMeta {
  id: string;
  kind: "image" | "attachment";
  filename: string;
  mime: string;
  size: number;
  published: boolean;
  createdAt: ISODate;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
