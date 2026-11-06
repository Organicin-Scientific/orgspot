import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
    APP_URL: z.url(),

    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    FIREBASE_STORAGE_BUCKET: z.string().min(1),
    ALLOWED_FIREBASE_PROJECT_ID: z.string().optional(),
    FIRESTORE_EMULATOR_HOST: z.string().optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
    FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),

    AUTH_REQUIRE_MFA: bool,
    SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(8),

    EMAIL_SENDING_ENABLED: bool,
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    RESEND_MAX_REQUESTS_PER_SECOND: z.coerce.number().min(0.5).max(50).default(2),
    SENDER_EMAIL: z.string().optional(),

    CRON_SECRET: z.string().min(32),
    TOKEN_SIGNING_SECRET: z.string().min(32),
    PDF_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  })
  .superRefine((env, ctx) => {
    const isProd = env.APP_ENV === "production" || env.VERCEL_ENV === "production";
    if (isProd) {
      if (!env.AUTH_REQUIRE_MFA) {
        ctx.addIssue({ code: "custom", message: "AUTH_REQUIRE_MFA must be true in production" });
      }
      if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST) {
        ctx.addIssue({ code: "custom", message: "Emulator hosts must not be set in production" });
      }
      if (!env.ALLOWED_FIREBASE_PROJECT_ID || env.ALLOWED_FIREBASE_PROJECT_ID !== env.FIREBASE_PROJECT_ID) {
        ctx.addIssue({
          code: "custom",
          message: "FIREBASE_PROJECT_ID must match ALLOWED_FIREBASE_PROJECT_ID in production",
        });
      }
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", message: "APP_URL must use https in production" });
      }
    }
    if (env.EMAIL_SENDING_ENABLED && (!env.RESEND_API_KEY || !env.RESEND_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: "custom",
        message: "RESEND_API_KEY and RESEND_WEBHOOK_SECRET are required when EMAIL_SENDING_ENABLED=true",
      });
    }
  });

export type Env = z.infer<typeof schema> & {
  isProduction: boolean;
  usesEmulators: boolean;
  /** True only when real email may leave the system. */
  liveSending: boolean;
};

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid server environment:\n${issues.join("\n")}`);
  }
  const e = parsed.data;
  const isProduction = e.APP_ENV === "production" || e.VERCEL_ENV === "production";
  const usesEmulators = Boolean(e.FIRESTORE_EMULATOR_HOST || e.FIREBASE_AUTH_EMULATOR_HOST);
  // Real sending requires production *and* an explicit opt-in flag. Preview and local never send.
  const liveSending = isProduction && e.EMAIL_SENDING_ENABLED && Boolean(e.RESEND_API_KEY);
  cached = { ...e, isProduction, usesEmulators, liveSending };
  return cached;
}

/** Test hook: clear the memoised environment. */
export function resetEnvCache() {
  cached = null;
}
