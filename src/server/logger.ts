import "server-only";

type Level = "debug" | "info" | "warn" | "error";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SENSITIVE_KEYS = /(email|token|secret|password|authorization|cookie|content|html|text|body|key|name|notes)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return value.replace(EMAIL_RE, "[email]");
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // IDs are safe and essential for debugging; anything that may carry personal or private data is dropped.
      if (SENSITIVE_KEYS.test(k) && !/id$/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...(meta ? (redact(meta) as object) : {}), ts: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") write("debug", msg, meta);
  },
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};

export { redact as redactForLog };
