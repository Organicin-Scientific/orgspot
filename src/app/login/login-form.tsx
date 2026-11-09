"use client";

import { useState } from "react";
import {
  GoogleAuthProvider,
  getMultiFactorResolver,
  multiFactor,
  signInWithPopup,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import QRCode from "qrcode";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientAuth } from "@/lib/firebase-client";

type Step =
  | { kind: "start" }
  | { kind: "enroll"; user: User; secret: TotpSecret; qr: string }
  | { kind: "verify"; resolver: MultiFactorResolver };

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; mfaRequired?: boolean; mfaSatisfied?: boolean };
  if (!res.ok) throw new Error(json.error?.message ?? "Sign-in failed. Please try again.");
  return json;
}

function friendly(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "Sign-in was cancelled.";
      case "auth/popup-blocked":
        return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
      case "auth/invalid-verification-code":
      case "auth/missing-code":
        return "That code is not correct. Check your authenticator app and try again.";
      case "auth/requires-recent-login":
        return "Please sign in again to continue.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        return "Sign-in failed. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Sign-in failed. Please try again.";
}

export function LoginForm({ next, expired, devLogin }: { next: string; expired: boolean; devLogin: boolean }) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(expired ? "Your session has ended. Please sign in again." : null);
  const [code, setCode] = useState("");
  const [devEmail, setDevEmail] = useState("dev@example.com");

  async function finish(user: User) {
    const idToken = await user.getIdToken(true);
    await postJson("/api/auth/session", { idToken });
    const auth = await clientAuth();
    await signOut(auth).catch(() => undefined);
    window.location.assign(next);
  }

  async function startGoogle() {
    setBusy(true);
    setError(null);
    const auth = await clientAuth();
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(auth, provider);
      const pre = await postJson("/api/auth/precheck", { idToken: await cred.user.getIdToken() });
      if (pre.mfaRequired && !pre.mfaSatisfied) {
        const session = await multiFactor(cred.user).getSession();
        const secret = await TotpMultiFactorGenerator.generateSecret(session);
        const uri = secret.generateQrCodeUrl(cred.user.email ?? "admin", "Organicin Investor Updates");
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 200 });
        setStep({ kind: "enroll", user: cred.user, secret, qr });
        return;
      }
      await finish(cred.user);
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "auth/multi-factor-auth-required") {
        setStep({ kind: "verify", resolver: getMultiFactorResolver(auth, err as MultiFactorError) });
        return;
      }
      await signOut(auth).catch(() => undefined);
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (step.kind === "enroll") {
        const assertion = TotpMultiFactorGenerator.assertionForEnrollment(step.secret, code);
        await multiFactor(step.user).enroll(assertion, "Authenticator app");
        await finish(step.user);
      } else if (step.kind === "verify") {
        const hint = step.resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
        if (!hint) throw new Error("No authenticator app is enrolled for this account. Contact another administrator.");
        const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
        const cred = await step.resolver.resolveSignIn(assertion);
        await finish(cred.user);
      }
    } catch (err) {
      setError(friendly(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function startDev(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth/dev-login", { email: devEmail });
      window.location.assign(next);
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <ShieldCheck className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">
            {step.kind === "start" ? "Investor Updates" : step.kind === "enroll" ? "Set up two-step verification" : "Two-step verification"}
          </CardTitle>
          <CardDescription>
            {step.kind === "start" && "Sign in with your approved Google account."}
            {step.kind === "enroll" &&
              "Scan this code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code."}
            {step.kind === "verify" && "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step.kind === "start" && (
          <>
            <Button className="w-full" size="lg" onClick={startGoogle} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <GoogleMark />}
              Continue with Google
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Access is limited to approved administrators. Two-step verification is required.
            </p>
            {devLogin && (
              <form onSubmit={startDev} className="space-y-2 rounded-lg border border-dashed p-3">
                <Label htmlFor="dev-email" className="text-xs text-muted-foreground">
                  Local emulator sign-in
                </Label>
                <div className="flex gap-2">
                  <Input id="dev-email" type="email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
                  <Button type="submit" variant="secondary" disabled={busy}>
                    Sign in
                  </Button>
                </div>
              </form>
            )}
          </>
        )}

        {step.kind !== "start" && (
          <form onSubmit={submitCode} className="space-y-4">
            {step.kind === "enroll" && (
              <div className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={step.qr} alt="QR code for your authenticator app" className="mx-auto size-44 rounded-md border bg-white p-2" />
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Can’t scan? Enter this key instead</summary>
                  <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-foreground">{step.secret.secretKey}</code>
                </details>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="totp">Verification code</Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.4em]"
                placeholder="000000"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {step.kind === "enroll" ? "Verify and finish setup" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={async () => {
                await signOut(await clientAuth()).catch(() => undefined);
                setStep({ kind: "start" });
                setCode("");
                setError(null);
              }}
            >
              Use a different account
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
