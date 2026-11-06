/**
 * Seed synthetic development data (Firestore emulator only).
 * Usage: npx tsx scripts/seed.ts [--force]
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type DocumentReference, type Firestore } from "firebase-admin/firestore";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const p = process as NodeJS.Process & { loadEnvFile?: (path: string) => void };
  if (typeof p.loadEnvFile === "function") {
    p.loadEnvFile(envLocalPath);
  }
}

const BATCH_LIMIT = 400;
const CATEGORIES = ["Angel", "VC", "Family office", "Strategic"] as const;

const GROUP_DEFS: { id: string; name: string; description: string }[] = [
  { id: "board", name: "Board", description: "Board members and observers" },
  { id: "seed-investors", name: "Seed investors", description: "Participants in the seed round" },
  { id: "series-a-prospects", name: "Series A prospects", description: "Potential Series A participants" },
];

const FIRST_NAMES = [
  "Alex",
  "Jordan",
  "Taylor",
  "Riley",
  "Casey",
  "Morgan",
  "Quinn",
  "Avery",
  "Jamie",
  "Skyler",
  "Reese",
  "Rowan",
  "Sage",
  "Blake",
  "Emerson",
  "Hayden",
  "Parker",
  "Finley",
  "Drew",
  "Logan",
];

const LAST_NAMES = [
  "Rivera",
  "Chen",
  "Patel",
  "Nguyen",
  "Okonkwo",
  "Silva",
  "Kim",
  "Garcia",
  "Thompson",
  "Ito",
  "Nielsen",
  "Kowalski",
  "Hernandez",
  "Fischer",
  "Dubois",
  "Martinez",
  "Cohen",
  "Rossi",
  "Andersen",
  "Bakker",
];

const ORGS = [
  "Example Ventures",
  "Sample Capital Partners",
  "Demo Angel Collective",
  "Placeholder Holdings",
  "Illustrative Growth Fund",
  "Mock Strategic Group",
  "Prototype Advisors LLC",
  "Synthetic Equity Co",
];

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function initFirebase(): void {
  if (getApps().length > 0) return;

  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    fail("Refusing to run: FIRESTORE_EMULATOR_HOST must be set (synthetic seed targets the emulator only).");
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    fail("FIREBASE_PROJECT_ID is required.");
  }

  const allowed = process.env.ALLOWED_FIREBASE_PROJECT_ID?.trim();
  if (allowed && projectId !== allowed) {
    fail(
      `Refusing to run: FIREBASE_PROJECT_ID (${projectId}) does not match ALLOWED_FIREBASE_PROJECT_ID (${allowed}).`,
    );
  }

  // The emulator accepts unauthenticated admin requests; no credential is needed.
  initializeApp({ projectId });
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function addPrefixes(token: string, out: Set<string>, maxLen = 15): void {
  const t = token.toLowerCase();
  const n = Math.min(t.length, maxLen);
  for (let i = 1; i <= n; i++) {
    out.add(t.slice(0, i));
  }
}

function buildSearchTokens(first: string, last: string, org: string, email: string): string[] {
  const out = new Set<string>();
  for (const w of words(first)) addPrefixes(w, out);
  for (const w of words(last)) addPrefixes(w, out);
  for (const w of words(org)) addPrefixes(w, out);

  const at = email.indexOf("@");
  const local = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at + 1) : "";
  addPrefixes(local.toLowerCase(), out);
  addPrefixes(email.toLowerCase(), out);
  addPrefixes(domain.toLowerCase(), out);

  return Array.from(out).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 300);
}

function pickGroups(i: number, groupIds: string[]): string[] {
  const base = i % 3;
  const g = [groupIds[base]];
  if (i % 4 === 0) {
    const second = groupIds[(base + 1) % 3];
    if (second !== g[0]) g.push(second);
  }
  return g;
}

type InvestorSpec = {
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  category: string;
  status: "active" | "unsubscribed" | "bounced";
};

function buildInvestorSpecs(): InvestorSpec[] {
  const specs: InvestorSpec[] = [];
  for (let a = 0; a < 40; a++) {
    const firstName = FIRST_NAMES[a % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(a + Math.floor(a / FIRST_NAMES.length)) % LAST_NAMES.length];
    const org = ORGS[a % ORGS.length];
    const domain = a % 2 === 0 ? "example.com" : "example.org";
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${a}@${domain}`;
    let status: InvestorSpec["status"] = "active";
    if (a === 37 || a === 38) status = "unsubscribed";
    else if (a === 39) status = "bounced";
    specs.push({
      firstName,
      lastName,
      email,
      organization: org,
      category: CATEGORIES[a % CATEGORIES.length],
      status,
    });
  }

  const extra: InvestorSpec[] = [
    {
      firstName: "Bounce",
      lastName: "Demo",
      email: "bounce-demo@bounce.test",
      organization: "Example Ventures",
      category: "Strategic",
      status: "bounced",
    },
    {
      firstName: "Complaint",
      lastName: "Demo",
      email: "complaint-demo@complaint.test",
      organization: "Sample Capital Partners",
      category: "VC",
      status: "unsubscribed",
    },
    {
      firstName: "Flaky",
      lastName: "Demo",
      email: "flaky-demo@flaky.test",
      organization: "Demo Angel Collective",
      category: "Angel",
      status: "active",
    },
  ];
  return specs.concat(extra);
}

async function deleteCollection(db: Firestore, name: string): Promise<void> {
  const ref = db.collection(name);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await ref.limit(BATCH_LIMIT).get();
    if (snap.empty) break;
    let batch = db.batch();
    let n = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      n++;
      if (n >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
    if (snap.size < BATCH_LIMIT) break;
  }
}

async function run(): Promise<void> {
  const force = process.argv.includes("--force");
  initFirebase();
  const db = getFirestore();

  const seedRef = db.doc("meta/seed");
  const seedSnap = await seedRef.get();
  if (seedSnap.exists && !force) {
    console.log("already seeded");
    return;
  }

  if (force) {
    await deleteCollection(db, "investors");
    await deleteCollection(db, "investorGroups");
    await deleteCollection(db, "investorEmails");
    await deleteCollection(db, "suppressionList");
    if (seedSnap.exists) {
      await seedRef.delete();
    }
  }

  const ts = FieldValue.serverTimestamp();
  const groupIds = GROUP_DEFS.map((g) => g.id);

  let batch = db.batch();
  let opCount = 0;

  const flush = async (): Promise<void> => {
    if (opCount === 0) return;
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  };

  const setDoc = async (ref: DocumentReference, data: Record<string, unknown>): Promise<void> => {
    batch.set(ref, data, { merge: true });
    opCount++;
    if (opCount >= BATCH_LIMIT) {
      await flush();
    }
  };

  for (const g of GROUP_DEFS) {
    await setDoc(db.collection("investorGroups").doc(g.id), {
      name: g.name,
      nameLower: g.name.toLowerCase(),
      description: g.description,
      memberCount: 0,
      createdAt: ts,
      updatedAt: ts,
      createdBy: "seed",
    });
  }

  const specs = buildInvestorSpecs();
  const memberCounts: Record<string, number> = Object.fromEntries(groupIds.map((id) => [id, 0]));

  const rows: { ref: DocumentReference; spec: InvestorSpec }[] = [];
  for (let i = 0; i < specs.length; i++) {
    rows.push({ ref: db.collection("investors").doc(), spec: specs[i] });
  }

  for (let i = 0; i < rows.length; i++) {
    const { ref, spec } = rows[i];
    const id = ref.id;
    const emailNormalized = spec.email.trim().toLowerCase();
    const gIds = pickGroups(i, groupIds);
    for (const gid of gIds) {
      memberCounts[gid] = (memberCounts[gid] ?? 0) + 1;
    }
    const sortKey = `${spec.lastName.toLowerCase()}\u0000${spec.firstName.toLowerCase()}\u0000${id}`;
    const searchTokens = buildSearchTokens(spec.firstName, spec.lastName, spec.organization, spec.email);

    await setDoc(ref, {
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: spec.email,
      emailNormalized,
      organization: spec.organization,
      category: spec.category,
      notes: "",
      groupIds: gIds,
      status: spec.status,
      searchTokens,
      sortKey,
      createdAt: ts,
      updatedAt: ts,
      createdBy: "seed",
    });

    await setDoc(db.collection("investorEmails").doc(emailNormalized), {
      investorId: id,
    });

    if (spec.status === "unsubscribed") {
      await setDoc(db.collection("suppressionList").doc(emailNormalized), {
        email: spec.email,
        reason: "unsubscribe",
        source: "seed",
        createdAt: ts,
      });
    } else if (spec.status === "bounced") {
      await setDoc(db.collection("suppressionList").doc(emailNormalized), {
        email: spec.email,
        reason: "hard_bounce",
        source: "seed",
        createdAt: ts,
      });
    }
  }

  for (const g of GROUP_DEFS) {
    await setDoc(db.collection("investorGroups").doc(g.id), {
      memberCount: memberCounts[g.id] ?? 0,
      updatedAt: ts,
    });
  }

  await setDoc(db.doc("meta/investorCategories"), {
    values: [...CATEGORIES],
  });

  await setDoc(db.doc("settings/app"), {
    branding: {
      companyName: "Organicin Scientific",
      logoAssetId: null,
      primaryColor: "#1f6f5c",
      textColor: "#1a1a1a",
      fontFamily: "helvetica",
    },
    sender: {
      fromName: "Organicin Scientific",
      fromEmail: "updates@updates.example.com",
      replyTo: "ir@example.com",
    },
    postalAddress: "123 Example Street, Suite 100, Example City, ST 00000",
    footerNote:
      "You are receiving this because you are an investor in or advisor to Organicin Scientific.",
    updatedAt: ts,
    updatedBy: "seed",
  });

  await setDoc(db.collection("admins").doc("dev@example.com"), {
    email: "dev@example.com",
    role: "admin",
    active: true,
    addedBy: "seed",
    addedAt: ts,
  });

  await setDoc(seedRef, {
    version: 1,
    seededAt: ts,
    by: "seed",
  });

  await flush();

  console.log(`Seeded: ${specs.length} investors, ${GROUP_DEFS.length} groups, meta/settings/admin.`);
}

run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
