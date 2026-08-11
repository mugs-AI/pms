/**
 * Server-only classification of the configured Supabase server credential.
 *
 * Classification ONLY: this never returns, logs or echoes the credential or any
 * part of its decoded payload. The connected-database operation remains the
 * final proof that the credential actually works.
 */
export type ServerKeyClass =
  | "missing"
  | "modern_secret"
  | "legacy_service_role"
  | "rejected_publishable"
  | "rejected_legacy_role"
  | "rejected_malformed";

const MAX_KEY_LENGTH = 8192;

function decodePayloadRole(segment: string): string | null {
  try {
    const normalised = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    const json = atob(padded);
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    const role = (payload as Record<string, unknown>)["role"];
    return typeof role === "string" ? role.trim() : null;
  } catch {
    return null;
  }
}

export function classifyServerKey(key: string | undefined | null): ServerKeyClass {
  if (!key) return "missing";
  if (key.length > MAX_KEY_LENGTH) return "rejected_malformed";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(key)) return "rejected_malformed";
  if (key.startsWith("sb_publishable_")) return "rejected_publishable";
  if (key.startsWith("sb_secret_")) return "modern_secret";

  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) return "rejected_malformed";
  const role = decodePayloadRole(parts[1]);
  if (role === null) return "rejected_malformed";
  return role === "service_role" ? "legacy_service_role" : "rejected_legacy_role";
}

export function isValidServerKeyClass(key: string | undefined | null): boolean {
  const c = classifyServerKey(key);
  return c === "modern_secret" || c === "legacy_service_role";
}
