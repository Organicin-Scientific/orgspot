"use client";

import { useSyncExternalStore } from "react";
import { greeting } from "@/lib/dashboard";

const subscribe = () => () => {};
/** Minute resolution keeps the snapshot stable between renders. */
const clientNow = () => Math.floor(Date.now() / 60_000);
const serverNow = () => null;

/** Rendered on the client so the greeting and date follow the viewer's clock, not the server's. */
export function DashboardGreeting({ name }: { name: string }) {
  const minute = useSyncExternalStore(subscribe, clientNow, serverNow);
  const now = minute === null ? null : new Date(minute * 60_000);
  const date = now?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="space-y-1">
      <p className="h-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">{date ?? ""}</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {now ? greeting(now.getHours()) : "Welcome back"}
        {name ? `, ${name}` : ""}
      </h1>
    </div>
  );
}
