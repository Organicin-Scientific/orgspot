import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { collectAssetIds } from "@/lib/content/schema";
import { audit } from "../audit";
import { fullSendReadiness, getSettings } from "../db/settings";
import { getUpdate } from "../db/updates";
import { emailProvider } from "../email";
import { renderUpdatePdf } from "../email/pdf";
import { PLACEHOLDERS, pdfFilename, personalize, renderUpdateEmail, testPersonalization } from "../email/render";
import { env } from "../env";
import { db } from "../firebase-admin";
import { notFound, precondition } from "../http/errors";
import { getAssets, publishAssets } from "../storage";
import { senderDomainCheck } from "./prepare";

export interface TestSendResult {
  to: string;
  ok: boolean;
  error?: string;
}

/** Send a clearly labelled test of the current draft to explicitly entered addresses. */
export async function sendTestEmail(updateId: string, recipients: string[], actor: string) {
  const update = await getUpdate(updateId);
  if (!update) throw notFound("Update not found");
  if (!update.subject.trim()) throw precondition("Add an email subject before sending a test.");
  const settings = await getSettings();
  const readiness = await fullSendReadiness(settings);
  if (!readiness.ready) throw precondition(readiness.problems[0], { problems: readiness.problems });
  const domainProblem = await senderDomainCheck(settings.sender.fromEmail);
  if (domainProblem) throw precondition(domainProblem);

  const attachments = (await getAssets(update.attachmentIds)).filter((a) => a.kind === "attachment");
  const rendered = await renderUpdateEmail({
    title: update.title,
    subject: update.subject,
    previewText: update.previewText,
    content: update.content,
    bannerAssetId: update.bannerAssetId,
    pdfDelivery: update.pdfDelivery,
    attachments,
    settings,
    mode: "test",
  });
  await publishAssets([
    ...collectAssetIds(update.content),
    ...(update.bannerAssetId ? [update.bannerAssetId] : []),
    ...(settings.branding.logoAssetId ? [settings.branding.logoAssetId] : []),
  ]);

  const pdf =
    update.pdfDelivery === "attach"
      ? await renderUpdatePdf({
          title: update.title,
          content: update.content,
          bannerAssetId: update.bannerAssetId,
          settings,
          dateLabel: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        })
      : null;

  const values = testPersonalization();
  for (const a of attachments) values[PLACEHOLDERS.file(a.id)] = `${env().APP_URL}/d/test`;
  const html = personalize(rendered.html, values);
  const text = personalize(rendered.text, values);
  const from = `"${settings.sender.fromName.replace(/["\r\n<>]/g, "")}" <${settings.sender.fromEmail}>`;
  const provider = emailProvider();
  const results: TestSendResult[] = [];
  for (const to of recipients) {
    const res = await provider.send({
      from,
      to,
      replyTo: settings.sender.replyTo || undefined,
      subject: `[TEST] ${update.subject}`,
      html,
      text,
      headers: {},
      tags: { kind: "test", update_id: update.id },
      attachments: pdf ? [{ filename: pdfFilename(update.title), content: pdf, contentType: "application/pdf" }] : undefined,
      idempotencyKey: `test-${randomUUID()}`,
    });
    results.push(res.ok ? { to, ok: true } : { to, ok: false, error: res.message });
    await db()
      .collection("testSends")
      .add({
        updateId,
        updateVersion: update.version,
        recipientCount: 1,
        recipientDomain: to.split("@")[1] ?? "",
        ok: res.ok,
        providerMessageId: res.ok ? res.messageId : null,
        provider: provider.name,
        sentBy: actor,
        at: FieldValue.serverTimestamp(),
      });
  }
  const okCount = results.filter((r) => r.ok).length;
  await audit({
    actorEmail: actor,
    action: "update.test_send",
    resourceType: "update",
    resourceId: updateId,
    summary: `Sent a test of "${update.title}" to ${okCount} of ${results.length} address(es)${provider.live ? "" : " (sandbox)"}`,
  });
  return { results, sandbox: !provider.live };
}
