/**
 * Browser-side N3 access. Everything here targets THIS app's origin only.
 * The browser never calls openapi.account.qne.cloud directly, and it never
 * treats a JWT claim as authority — Owner/tenant identity comes from the
 * server session endpoint.
 */

export const TOKEN_KEY = "qne_access_token";
export const TOKEN_EXP_KEY = "qne_token_expiration";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const expiration = window.localStorage.getItem(TOKEN_EXP_KEY);
  if (expiration) {
    const at = Date.parse(expiration);
    if (Number.isFinite(at) && at <= Date.now()) {
      clearToken();
      return null;
    }
  }
  return token;
}

export function setToken(token: string, expiration?: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (expiration) window.localStorage.setItem(TOKEN_EXP_KEY, expiration);
  else window.localStorage.removeItem(TOKEN_EXP_KEY);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_EXP_KEY);
}

export class N3Error extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ApiEnvelope<T> = {
  code?: string;
  success?: boolean;
  message?: string;
  data?: T;
};

/** code === "0000" → data */
export function unwrapApiResponse<T>(body: ApiEnvelope<T>, status = 200): T {
  if (body?.code !== "0000" && body?.success !== true) {
    throw new N3Error(body?.message ?? "N3 returned an error", status, body?.code);
  }
  return body.data as T;
}

/** PageQueryResult → { rows, total } */
export function unwrapPageList<T>(data: unknown): { rows: T[]; total: number } {
  const page = data as { value?: T[]; count?: number } | null;
  return { rows: page?.value ?? [], total: page?.count ?? 0 };
}

export type Query = Record<string, string | number | boolean | undefined>;

/**
 * Handles the shared response semantics: 401 means the N3 session is gone and
 * the token is cleared; 403 is a permission decision and MUST NOT sign the
 * user out.
 */
async function readResponse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (res.status === 401) {
    clearToken();
    throw new N3Error("Session expired — relaunch from N3 My Apps", 401);
  }
  if (res.status === 403) {
    throw new N3Error(body?.message ?? "Permission denied for this N3 session", 403);
  }
  if (!body) throw new N3Error(`Request failed (${res.status})`, res.status);
  return unwrapApiResponse<T>(body, res.status);
}

/** GET through the same-origin allowlisted proxy. `path` is the Open API path. */
export async function n3Get<T>(
  path: string,
  query: Query = {},
  target: "main" = "main",
): Promise<T> {
  const token = getToken();
  if (!token) throw new N3Error("Not signed in", 401);

  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  const url = `/api/public/n3/${target}/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return readResponse<T>(res);
}

export type SessionDto = {
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
  displayName: string | null;
  isOwner: boolean;
  hasTenantIdentity: boolean;
  hasUserIdentity: boolean;
  correlationId: string;
  provisioning?: { status: string; role?: string; reason?: string };
};

/** Server-resolved session. The only authority for company, tenant and Owner. */
export async function fetchN3Session(): Promise<SessionDto> {
  const token = getToken();
  if (!token) throw new N3Error("Not signed in", 401);
  const res = await fetch("/api/public/n3/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return readResponse<SessionDto>(res);
}

function decodeBase64Url(part: string): string | null {
  try {
    const normalised = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) return null;
    return atob(padded);
  } catch {
    return null;
  }
}

function safeEmail(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const s = candidate.trim();
    if (s && s.length <= 256 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  }
  return null;
}

/**
 * NON-AUTHORITATIVE display fallback only. Never used for Owner, tenant
 * identity or any permission decision.
 */
export function emailFromJwt(token: string): string | null {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) return null;
  const json = decodeBase64Url(payloadPart);
  if (!json) return null;
  try {
    const claims = JSON.parse(json) as Record<string, unknown>;
    return safeEmail(
      claims["email"] ??
        claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
    );
  } catch {
    return null;
  }
}
