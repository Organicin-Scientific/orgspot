"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
};

/** Same-origin JSON API call with the CSRF header; redirects to sign-in when the session has expired. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, signal: opts.signal, credentials: "same-origin", cache: "no-store" });
  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    // Full reload so no investor data survives in client memory once the session is gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${next}&expired=1`;
    throw new ApiError(401, "unauthorized", "Your session has expired. Please sign in again.");
  }
  const text = await res.text();
  const json = text ? safeParse(text) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details ?? null);
  }
  return json as T;
}

/**
 * POSTs a form to a route that streams newline-delimited JSON events. Calls `onEvent` for
 * each one in order. Input errors that come back as a normal JSON error response throw
 * `ApiError`, as `api` does.
 */
export async function apiStream(
  path: string,
  form: FormData,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/x-ndjson", "x-csrf-token": csrfToken() },
    body: form,
    signal,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${next}&expired=1`;
    throw new ApiError(401, "unauthorized", "Your session has expired. Please sign in again.");
  }
  const streaming = (res.headers.get("content-type") ?? "").includes("ndjson");
  if (!res.ok || !streaming || !res.body) {
    const json = safeParse(await res.text()) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    const err = json?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details ?? null);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += value;
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line) {
        const event = safeParse(line);
        if (event !== null) onEvent(event);
      }
    }
    if (done) break;
  }
  const tail = buffered.trim() ? safeParse(buffered.trim()) : null;
  if (tail !== null) onEvent(tail);
}

/**
 * POST JSON and get the response back as a file, e.g. a PDF rendered from unsaved editor
 * content. Errors come back as the same ApiError the JSON helper throws.
 */
export async function postForFile(path: string, body: unknown, signal?: AbortSignal): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const json = safeParse(await res.text()) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Download failed (${res.status})`);
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  return { blob: await res.blob(), filename: encoded ? decodeURIComponent(encoded) : null };
}

/** Hand a Blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return "Request cancelled";
  return "Something went wrong. Please try again.";
}
