import type {
  EventDoc,
  SentryBreadcrumb,
  SentryExceptionValue,
} from "@/lib/types";

// Event payloads are attacker-controlled JSON stored under a permissive cast, so
// a field the type says is a string can be an object/number at runtime. Coerce
// before rendering — an object passed as a React child throws and 500s the page.
export function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function exceptionValues(payload: EventDoc["payload"]): SentryExceptionValue[] {
  const exc = payload.exception;
  if (!exc) return [];
  if (Array.isArray(exc)) return exc;
  return exc.values ?? [];
}

export function messageText(payload: EventDoc["payload"]): string | null {
  const m = payload.message;
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const text = m.formatted ?? m.message;
    return text == null ? null : str(text);
  }
  return null;
}

export function breadcrumbs(payload: EventDoc["payload"]): SentryBreadcrumb[] {
  const bc = payload.breadcrumbs;
  if (!bc) return [];
  const values = Array.isArray(bc) ? bc : bc.values;
  return Array.isArray(values) ? values : [];
}

export function crumbTime(ts: SentryBreadcrumb["timestamp"]): string {
  if (ts == null) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 23);
}
