"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

/** Shortest time a label stays up, so a burst of steps still reads as separate steps. */
const MIN_DWELL_MS = 450;

type Shown = { key: number; label: string };

/**
 * Live status line for a running assistant turn. `steps` is every label the server has sent so
 * far; the ticker rolls to the newest one, holding each for at least MIN_DWELL_MS.
 */
export function AssistantTicker({ steps, startedAt }: { steps: string[]; startedAt: number }) {
  const [current, setCurrent] = useState<Shown>({ key: 0, label: steps.at(-1) ?? "Starting" });
  const [previous, setPrevious] = useState<Shown | null>(null);
  const shownAt = useRef(0);
  const elapsed = useElapsed(startedAt);

  const latest = steps.at(-1);
  useEffect(() => {
    if (!latest || latest === current.label) return;
    const wait = Math.max(0, shownAt.current + MIN_DWELL_MS - Date.now());
    const t = window.setTimeout(() => {
      shownAt.current = Date.now();
      setPrevious(current);
      setCurrent({ key: current.key + 1, label: latest });
    }, wait);
    return () => window.clearTimeout(t);
  }, [latest, current]);

  return (
    <li className="flex items-center gap-2.5 text-sm transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0">
      <span className="assistant-orb" aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <span className="relative h-5 min-w-0 flex-1 overflow-hidden">
        {previous && (
          <span key={`out-${previous.key}`} className="ticker-line ticker-out" aria-hidden>
            {previous.label}
          </span>
        )}
        <span key={`in-${current.key}`} className="ticker-line ticker-in">
          <span className="assistant-thinking">{current.label}</span>
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-label={`Step ${steps.length || 1}, ${elapsed} seconds`}>
        step {Math.max(steps.length, 1)} · {formatElapsed(elapsed)}
      </span>
    </li>
  );
}

function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
