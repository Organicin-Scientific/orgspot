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
      <div className="flex h-4 items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {/* The page's h1 stays "Dashboard" so screen readers and tests can find the page by name. */}
        <h1>Dashboard</h1>
        {date && (
          <>
            <span aria-hidden>·</span>
            <span>{date}</span>
          </>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight">
        {now ? greeting(now.getHours()) : "Welcome back"}
        {name ? `, ${name}` : ""}
      </p>
    </div>
  );
}
