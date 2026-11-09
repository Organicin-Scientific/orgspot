import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings } from "@/server/db/settings";
import { verifyToken } from "@/server/tokens";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

async function companyName(): Promise<string> {
  try {
    const s = await getSettings();
    return s.branding.companyName || "Organicin Scientific";
  } catch {
    return "Organicin Scientific";
  }
}

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const company = await companyName();
  const valid = !!verifyToken("unsub", token, 2);
  const done = sp.done === "1";

  if (!valid) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>This link is invalid</CardTitle>
            <CardDescription>
              The unsubscribe link may have expired or been copied incorrectly. If you need help, reply to a previous investor update from {company}.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unsubscribed</CardTitle>
            <CardDescription className="text-base leading-relaxed">
              You have been unsubscribed. You will no longer receive investor updates from {company}. If this was a mistake, reply to any previous update to be
              added back.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Unsubscribe from investor updates</CardTitle>
          <CardDescription>
            You will stop receiving investor updates from {company}. This only affects this mailing list, not other messages you may get from us through other
            channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="post" action={`/api/unsubscribe/${token}?form=1`} className="space-y-3">
            <Button type="submit" className="w-full sm:w-auto">
              Unsubscribe
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
