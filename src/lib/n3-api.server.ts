/**
 * Server-only N3 Open API helpers. Base URLs live here (never in the browser bundle).
 * Only allowlisted GET reads are ever forwarded (see src/lib/n3-allowlist.ts).
 */

export type ApiEnvelope<T = unknown> = {
  type?: string;
  success?: boolean;
  code?: string;
  message?: string;
  data?: T;
  error?: unknown;
};

export const UPSTREAM_TIMEOUT_MS = 15_000;
export const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;

export function getBaseUrl(target: "main" | "reporting") {
  if (target === "reporting") {
    return (
      process.env["OPEN_API_REPORTING_BASE_URL"] ?? "https://openapi-reporting.account.qne.cloud"
    );
  }
  return process.env["OPEN_API_BASE_URL"] ?? "https://openapi.account.qne.cloud";
}

export function isDevRuntime() {
  return process.env["NODE_ENV"] !== "production";
}

export function newCorrelationId() {
  return crypto.randomUUID();
}

export type UpstreamOutcome =
  | { ok: true; status: number; body: unknown; bytes: number }
  | { ok: false; status: number; outcome: "timeout" | "unreachable" | "too_large" | "non_json" };

/**
 * Forwards a GET to N3 Open API with the caller's bearer token.
 * Bounded by a timeout, a maximum response size and JSON content validation.
 * Never returns upstream headers, secrets or raw internal errors.
 */
export async function n3Get(
  target: "main",
  path: string,
  search: string,
  bearerToken: string,
): Promise<UpstreamOutcome> {
  const url = `${getBaseUrl(target)}/${path}${search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted =
      typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "AbortError";
    return { ok: false, status: aborted ? 504 : 502, outcome: aborted ? "timeout" : "unreachable" };
  }
  clearTimeout(timer);

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
    return { ok: false, status: 502, outcome: "too_large" };
  }

  const contentType = res.headers.get("content-type") ?? "";
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, status: 502, outcome: "unreachable" };
  }
  if (text.length > MAX_UPSTREAM_BYTES) {
    return { ok: false, status: 502, outcome: "too_large" };
  }
  if (res.status !== 204 && !contentType.toLowerCase().includes("json")) {
    return { ok: false, status: 502, outcome: "non_json" };
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, status: 502, outcome: "non_json" };
  }

  return { ok: true, status: res.status, body, bytes: text.length };
}
