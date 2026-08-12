/**
 * Server-only reader for the N3-issued access token payload.
 *
 * Why this exists: the live `CompanyProfile/BasicInfo` contract in production
 * returns company attributes only (tenantCode, companyName, ...). It carries no
 * immutable tenant id, no user id and no owner flag. The only place N3 publishes
 * those identities is the access token it mints for the caller.
 *
 * Trust model — this payload is decoded, NOT signature-verified here. Its
 * authority comes entirely from two external facts:
 *  - live BasicInfo acceptance validates this exact N3 token and supplies the
 *    live tenant-code binding;
 *  - the verified `sys-admin` role inside that same N3-accepted token supplies
 *    Owner authority.
 * Claims may only be consumed after the mandatory tenant-code binding in
 * resolveN3Session passes. The browser can never supply these values — they are
 * read server-side from the Authorization header only. An `isOwner` claim is
 * ignored completely, in every shape.
 */

export type N3TokenClaims = {
  tenantId: string | null;
  tenantCode: string | null;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  /** true only for the exact, proven N3 role claim `sys-admin`. */
  isSystemAdmin: boolean;
};

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function base64UrlDecode(segment: string): string | null {
  try {
    const normalised = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

/** The ONLY role proven by the live N3 contract to convey Owner authority. */
const OWNER_ROLE = "sys-admin";

/** Decodes the payload of an N3 access token. Signature is NOT verified here. */
export function decodeN3TokenClaims(token: string): N3TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const json = base64UrlDecode(parts[1]);
  if (!json) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const c = payload as Record<string, unknown>;

  const rawRoles = c["roles"];
  const roleList = (Array.isArray(rawRoles) ? rawRoles : [rawRoles])
    .map((r) => safeString(r)?.toLowerCase())
    .filter((r): r is string => Boolean(r))
    .flatMap((r) => r.split(","))
    .map((r) => r.trim());

  const email = safeString(c["email"]);
  // Only the exact claim names proven by the live N3 contract are consumed:
  // tenantId, tenantCode, uid, email, dname, roles. No snake_case aliases, no
  // `sub` user-identity fallback and no `name` display fallback.
  return {
    tenantId: safeString(c["tenantId"]),
    tenantCode: safeString(c["tenantCode"]),
    userId: safeString(c["uid"]),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    displayName: safeString(c["dname"]),
    isSystemAdmin: roleList.some((r) => r === OWNER_ROLE),
  };
}
