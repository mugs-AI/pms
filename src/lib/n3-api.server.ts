/**
 * Server-only N3 Open API helpers. Base URLs live here (never in the browser bundle).
 */

export type ApiEnvelope<T = unknown> = {
  type?: string;
  success?: boolean;
  code?: string;
  message?: string;
  data?: T;
  error?: unknown;
};

export function getBaseUrl(target: "main" | "reporting") {
  if (target === "reporting") {
    return (
      process.env["OPEN_API_REPORTING_BASE_URL"] ??
      "https://openapi-reporting.account.qne.cloud"
    );
  }
  return process.env["OPEN_API_BASE_URL"] ?? "https://openapi.account.qne.cloud";
}

export function isDevRuntime() {
  return process.env["NODE_ENV"] !== "production";
}

/** Forwards a GET to N3 Open API with the caller's bearer token. */
export async function n3Get(
  target: "main" | "reporting",
  path: string,
  search: string,
  bearer: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${getBaseUrl(target)}/${path.replace(/^\/+/, "")}${search}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: bearer.startsWith("Bearer ") ? bearer : `Bearer ${bearer}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { code: "PROXY", success: false, message: "Non-JSON response from N3" };
  }
  return { status: res.status, body };
}