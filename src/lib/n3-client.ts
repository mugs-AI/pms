/**
 * Browser-side N3 access. Everything here targets THIS app's origin only.
 * The browser never calls openapi.account.qne.cloud directly.
 */

export const TOKEN_KEY = "qne_access_token";
export const TOKEN_EXP_KEY = "qne_token_expiration";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, expiration?: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (expiration) window.localStorage.setItem(TOKEN_EXP_KEY, expiration);
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

/** GET through the same-origin proxy. `path` is the Open API path. */
export async function n3Get<T>(
  path: string,
  query: Query = {},
  target: "main" | "reporting" = "main",
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
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (res.status === 401 || res.status === 403) {
    clearToken();
    throw new N3Error("Session expired — sign in again", res.status);
  }
  if (!body) throw new N3Error(`Request failed (${res.status})`, res.status);
  return unwrapApiResponse<T>(body, res.status);
}

/** Reads a single `email` claim from the JWT payload (display only). */
export function emailFromJwt(token: string): string | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const json = atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Record<string, unknown>;
    const raw =
      claims["email"] ??
      claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];
    if (Array.isArray(raw)) return (raw[0] as string) ?? null;
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

export function claimsFromJwt(token: string): Record<string, unknown> {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return {};
    return JSON.parse(
      atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}