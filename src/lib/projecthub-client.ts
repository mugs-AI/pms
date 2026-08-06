/**
 * Browser-side ProjectHub API client.
 *
 * Same-origin only: every request targets `/api/projecthub/...`. This module
 * never imports a `.server.ts` module, never touches Supabase, never calls an
 * N3 host, and never derives authority from a JWT claim.
 */
import { clearToken, getToken, N3Error } from "./n3-client";
import type { Permission, ProjectHubRole } from "./projecthub-rbac";

export class ProjectHubError extends Error {
  status: number;
  correlationId: string | null;
  constructor(message: string, status: number, correlationId: string | null) {
    super(message);
    this.name = "ProjectHubError";
    this.status = status;
    this.correlationId = correlationId;
  }
}

export type ProjectHubSession = {
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
  displayName: string | null;
  isOwner: boolean;
  hasTenantIdentity: boolean;
  hasUserIdentity: boolean;
  projectHubRole: ProjectHubRole;
  roleLabel: string;
  roleStatus: "owner" | "assigned" | "unassigned" | "disabled" | "identity_missing";
  permissions: Permission[];
  correlationId: string;
};

type Envelope<T> = { code?: string; success?: boolean; message?: string; data?: T };

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `/api/projecthub/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
}

/** Performs one same-origin ProjectHub call and unwraps the shared envelope. */
export async function projectHubRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new ProjectHubError("Not signed in", 401, null);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const res = await fetch(buildUrl(path, options.query), init);

  const correlationId = res.headers.get("x-correlation-id");
  const body = (await res.json().catch(() => null)) as (Envelope<T> & { correlationId?: string }) | null;

  if (res.status === 401) {
    // The N3 session is gone: drop the token and fall back to the launch state.
    clearToken();
    throw new ProjectHubError("Session expired — relaunch from N3 My Apps", 401, correlationId);
  }
  if (!res.ok || (body?.code !== "0000" && body?.success !== true)) {
    throw new ProjectHubError(
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.correlationId ?? correlationId,
    );
  }
  return body.data as T;
}

export function fetchProjectHubSession(): Promise<ProjectHubSession> {
  return projectHubRequest<ProjectHubSession>("session");
}

/** Sanitised user-facing message plus a support reference when present. */
export function describeError(error: unknown): { message: string; correlationId: string | null } {
  if (error instanceof ProjectHubError) {
    return { message: error.message, correlationId: error.correlationId };
  }
  if (error instanceof N3Error) return { message: error.message, correlationId: null };
  if (error instanceof Error) return { message: error.message, correlationId: null };
  return { message: "Something went wrong", correlationId: null };
}
