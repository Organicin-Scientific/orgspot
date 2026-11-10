import "server-only";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import type { AssistantMessage } from "@/lib/types";
import { db } from "../firebase-admin";
import { data, isoRequired, str } from "./convert";
import { updatesCol } from "./updates";

/** Conversation with the drafting assistant, stored per update at `updates/{id}/assistantMessages`. */
const messagesCol = (updateId: string) => updatesCol().doc(updateId).collection("assistantMessages");

export const MAX_STORED_MESSAGE_CHARS = 80_000;
const LIST_LIMIT = 200;

function toMessage(snap: DocumentSnapshot): AssistantMessage {
  const d = data(snap);
  return {
    id: snap.id,
    role: d.role === "assistant" ? "assistant" : "user",
    text: str(d.text),
    fileName: typeof d.fileName === "string" ? d.fileName : null,
    changeSummary: typeof d.changeSummary === "string" ? d.changeSummary : null,
    createdBy: str(d.createdBy),
    createdAt: isoRequired(d.createdAt),
  };
}

/** Oldest first, capped to the most recent messages. */
export async function listAssistantMessages(updateId: string): Promise<AssistantMessage[]> {
  const snap = await messagesCol(updateId).orderBy("createdAt", "desc").limit(LIST_LIMIT).get();
  return snap.docs.map(toMessage).reverse();
}

export async function appendAssistantTurn(
  updateId: string,
  actor: string,
  user: { text: string; fileName: string | null },
  assistant: { text: string; changeSummary: string | null },
): Promise<AssistantMessage[]> {
  const userRef = messagesCol(updateId).doc();
  const assistantRef = messagesCol(updateId).doc();
  const now = Date.now();
  const batch = db().batch();
  // Explicit, ordered timestamps keep the pair in order even when both land in one write.
  batch.create(userRef, {
    role: "user",
    text: user.text.slice(0, MAX_STORED_MESSAGE_CHARS),
    fileName: user.fileName,
    changeSummary: null,
    createdBy: actor,
    createdAt: new Date(now),
    storedAt: FieldValue.serverTimestamp(),
  });
  batch.create(assistantRef, {
    role: "assistant",
    text: assistant.text.slice(0, MAX_STORED_MESSAGE_CHARS),
    fileName: null,
    changeSummary: assistant.changeSummary,
    createdBy: actor,
    createdAt: new Date(now + 1),
    storedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  const [u, a] = await Promise.all([userRef.get(), assistantRef.get()]);
  return [toMessage(u), toMessage(a)];
}

export async function clearAssistantMessages(updateId: string): Promise<void> {
  await db().recursiveDelete(messagesCol(updateId));
}
