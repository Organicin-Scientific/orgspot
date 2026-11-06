import "server-only";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import type { InvestorGroup } from "@/lib/types";
import { db } from "../firebase-admin";
import { conflict, notFound } from "../http/errors";
import { data, isoRequired, num, str } from "./convert";
import { groupsCol, investorsCol } from "./investors";

export function toGroup(snap: DocumentSnapshot): InvestorGroup {
  const d = data(snap);
  return {
    id: snap.id,
    name: str(d.name),
    description: str(d.description),
    memberCount: Math.max(0, num(d.memberCount)),
    createdAt: isoRequired(d.createdAt),
    updatedAt: isoRequired(d.updatedAt),
  };
}

export async function listGroups(): Promise<InvestorGroup[]> {
  const snap = await groupsCol().orderBy("nameLower").limit(500).get();
  return snap.docs.map(toGroup);
}

export async function getGroup(id: string): Promise<InvestorGroup | null> {
  const snap = await groupsCol().doc(id).get();
  return snap.exists ? toGroup(snap) : null;
}

async function assertUniqueName(name: string, exceptId?: string) {
  const snap = await groupsCol().where("nameLower", "==", name.trim().toLowerCase()).limit(2).get();
  if (snap.docs.some((d) => d.id !== exceptId)) throw conflict("A group with this name already exists");
}

export async function createGroup(input: { name: string; description: string }, actor: string) {
  await assertUniqueName(input.name);
  const ref = groupsCol().doc();
  await ref.create({
    name: input.name.trim(),
    nameLower: input.name.trim().toLowerCase(),
    description: input.description.trim(),
    memberCount: 0,
    createdBy: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return (await getGroup(ref.id))!;
}

export async function updateGroup(id: string, input: { name?: string; description?: string }) {
  const ref = groupsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Group not found");
  if (input.name) await assertUniqueName(input.name, id);
  await ref.update({
    ...(input.name ? { name: input.name.trim(), nameLower: input.name.trim().toLowerCase() } : {}),
    ...(input.description !== undefined ? { description: input.description.trim() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return (await getGroup(id))!;
}

/** Deleting a group removes the membership from every investor; contacts themselves are kept. */
export async function deleteGroup(id: string) {
  const ref = groupsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Group not found");
  for (;;) {
    const members = await investorsCol().where("groupIds", "array-contains", id).limit(400).get();
    if (members.empty) break;
    const batch = db().batch();
    for (const m of members.docs) {
      batch.update(m.ref, { groupIds: FieldValue.arrayRemove(id), updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  await ref.delete();
}

/** Recalculate a group's member count from source data (repairs drift after partial failures). */
export async function recountGroup(id: string) {
  const agg = await investorsCol().where("groupIds", "array-contains", id).count().get();
  await groupsCol().doc(id).update({ memberCount: agg.data().count });
}
