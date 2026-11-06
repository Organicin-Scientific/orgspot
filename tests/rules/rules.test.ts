import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { createMockUserToken } from '@firebase/util';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from 'firebase/firestore';
import {
  connectStorageEmulator,
  getBytes,
  getStorage,
  ref,
  uploadString,
} from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const PROJECT_ID = 'demo-organicin';
const HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const STORAGE_PORT = 9199;

const firestoreRules = readFileSync(
  join(repoRoot, 'firestore.rules'),
  'utf8',
);
const storageRules = readFileSync(join(repoRoot, 'storage.rules'), 'utf8');

function makeFirestore(appName: string, mockUserToken?: string) {
  const app = initializeApp({ projectId: PROJECT_ID }, appName);
  const db = getFirestore(app);
  if (mockUserToken !== undefined) {
    connectFirestoreEmulator(db, HOST, FIRESTORE_PORT, { mockUserToken });
  } else {
    connectFirestoreEmulator(db, HOST, FIRESTORE_PORT);
  }
  return { app, db };
}

function makeStorage(appName: string, mockUserToken?: string) {
  const app = initializeApp(
    {
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`,
    },
    appName,
  );
  const storage = getStorage(app, `gs://${PROJECT_ID}.appspot.com`);
  if (mockUserToken !== undefined) {
    connectStorageEmulator(storage, HOST, STORAGE_PORT, { mockUserToken });
  } else {
    connectStorageEmulator(storage, HOST, STORAGE_PORT);
  }
  return { app, storage };
}

describe('Firebase security rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: firestoreRules,
        host: HOST,
        port: FIRESTORE_PORT,
      },
      storage: {
        rules: storageRules,
        host: HOST,
        port: STORAGE_PORT,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('Firestore', () => {
    it('denies unauthenticated reads and writes for investors, campaigns, and admins', async () => {
      const { app, db } = makeFirestore('firestore-guest');
      try {
        await assertFails(getDoc(doc(db, 'investors', 'i1')));
        await assertFails(setDoc(doc(db, 'investors', 'i1'), { x: 1 }));
        await assertFails(getDoc(doc(db, 'campaigns', 'c1')));
        await assertFails(setDoc(doc(db, 'campaigns', 'c1'), { x: 1 }));
        await assertFails(getDoc(doc(db, 'admins', 'a1')));
        await assertFails(setDoc(doc(db, 'admins', 'a1'), { x: 1 }));
      } finally {
        await deleteApp(app);
      }
    });

    it('denies authenticated users (including admin email claims) for investors, campaigns, auditLogs, and suppressionList', async () => {
      const token = createMockUserToken(
        {
          sub: 'auth-user-1',
          email: 'admin@example.com',
          email_verified: true,
        },
        PROJECT_ID,
      );
      const { app, db } = makeFirestore('firestore-auth', token);
      try {
        await assertFails(getDoc(doc(db, 'investors', 'i1')));
        await assertFails(setDoc(doc(db, 'investors', 'i1'), { x: 1 }));
        await assertFails(getDoc(doc(db, 'campaigns', 'c1')));
        await assertFails(setDoc(doc(db, 'campaigns', 'c1'), { x: 1 }));
        await assertFails(getDoc(doc(db, 'auditLogs', 'a1')));
        await assertFails(setDoc(doc(db, 'auditLogs', 'a1'), { x: 1 }));
        await assertFails(getDoc(doc(db, 'suppressionList', 's1')));
        await assertFails(setDoc(doc(db, 'suppressionList', 's1'), { x: 1 }));
      } finally {
        await deleteApp(app);
      }
    });
  });

  describe('Storage', () => {
    it('denies reads and writes for sample paths (authenticated and unauthenticated)', async () => {
      await testEnv.withSecurityRulesDisabled(async () => {
        const { app, storage } = makeStorage('storage-seed', 'owner');
        try {
          await uploadString(ref(storage, 'uploads/x.png'), 'seed-bytes');
          await uploadString(
            ref(storage, 'campaigns/c1/update.pdf'),
            'seed-bytes',
          );
        } finally {
          await deleteApp(app);
        }
      });

      const guest = makeStorage('storage-guest');
      try {
        await assertFails(getBytes(ref(guest.storage, 'uploads/x.png')));
        await assertFails(
          uploadString(ref(guest.storage, 'uploads/x.png'), 'x'),
        );
        await assertFails(
          getBytes(ref(guest.storage, 'campaigns/c1/update.pdf')),
        );
        await assertFails(
          uploadString(ref(guest.storage, 'campaigns/c1/update.pdf'), 'x'),
        );
      } finally {
        await deleteApp(guest.app);
      }

      const token = createMockUserToken(
        {
          sub: 'auth-user-storage',
          email: 'admin@example.com',
          email_verified: true,
        },
        PROJECT_ID,
      );
      const authed = makeStorage('storage-auth', token);
      try {
        await assertFails(getBytes(ref(authed.storage, 'uploads/x.png')));
        await assertFails(
          uploadString(ref(authed.storage, 'uploads/x.png'), 'x'),
        );
        await assertFails(
          getBytes(ref(authed.storage, 'campaigns/c1/update.pdf')),
        );
        await assertFails(
          uploadString(ref(authed.storage, 'campaigns/c1/update.pdf'), 'x'),
        );
      } finally {
        await deleteApp(authed.app);
      }
    });
  });
});
