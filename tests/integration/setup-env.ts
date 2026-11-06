/**
 * Must run first: no imports — only synchronous process.env for the emulator project.
 */
import { randomBytes } from "node:crypto";

const whsec = `whsec_${randomBytes(24).toString("base64")}`;

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
process.env.APP_ENV = "local";
process.env.APP_URL = "http://localhost:3000";
process.env.FIREBASE_PROJECT_ID = "demo-organicin";
process.env.ALLOWED_FIREBASE_PROJECT_ID = "demo-organicin";
process.env.FIREBASE_STORAGE_BUCKET = "demo-organicin.appspot.com";
process.env.EMAIL_SENDING_ENABLED = "false";
process.env.CRON_SECRET = "test_cron_secret_integration_40chars_min____________________";
process.env.TOKEN_SIGNING_SECRET = "test_token_signing_secret_integration_40chars_min__________";
process.env.RESEND_WEBHOOK_SECRET = whsec;
// Populated by firebase emulators:exec
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
// Fast pacing for integration tests (default RESEND_MAX_REQUESTS_PER_SECOND is 2)
process.env.RESEND_MAX_REQUESTS_PER_SECOND = "50";
