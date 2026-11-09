import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getSession()) redirect(safeNext(sp.next));
  const appEnv = process.env.APP_ENV ?? "local";
  const devLogin =
    appEnv === "local" &&
    process.env.NEXT_PUBLIC_AUTH_EMULATOR_LOGIN === "true" &&
    !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const missingFirebase =
    !process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ||
    !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    !process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <LoginForm
        next={safeNext(sp.next)}
        expired={sp.expired === "1"}
        devLogin={devLogin}
        configError={missingFirebase ? "Firebase client configuration is missing on the server. Add the NEXT_PUBLIC_FIREBASE_* variables in Vercel (Preview and Production) from your Firebase project settings." : null}
      />
    </main>
  );
}

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}
