/**
 * Server-only N3 session resolution, real Owner enforcement and the ProjectHub
 * tenant/user bootstrap. This is the ONLY authority for tenant identity and the
 * Owner flag — never a client-decoded JWT claim.
 */
import type { Json } from "@/integrations/supabase/types";
import { BASIC_INFO_PATH } from "./n3-allowlist";
import { n3Get } from "./n3-api.server";

export type N3Session = {
  /** Immutable N3 tenant identity — required for any tenant-scoped database work. */
  n3TenantId: string | null;
  /** Editable display attribute. Never identity. */
  tenantCode: string | null;
  companyName: string | null;
  /** Immutable N3 user identity when the contract supplies it. */
  n3UserId: string | null;
  displayEmail: string | null;
  displayName: string | null;
  isOwner: boolean;
};

export type SessionResolution =
  { ok: true; session: N3Session } | { ok: false; status: number; message: string };

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/** Accepts a string or a string array; returns the first safe display value. */
export function normaliseDisplayEmail(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const s = str(candidate);
    if (s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  }
  return null;
}

export function normaliseBasicInfo(raw: unknown): N3Session | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  return {
    n3TenantId: str(d["tenantId"]) ?? str(d["tenantGuid"]) ?? str(d["dbId"]) ?? str(d["id"]),
    tenantCode: str(d["tenantCode"]),
    companyName: str(d["companyName"]) ?? str(d["name"]),
    n3UserId: str(d["userId"]) ?? str(d["currentUserId"]) ?? str(d["userGuid"]),
    displayEmail: normaliseDisplayEmail(d["email"] ?? d["userEmail"]),
    displayName: str(d["displayName"]) ?? str(d["userName"]),
    // Live BasicInfo is the ONLY Owner/Admin signal.
    isOwner: d["isOwner"] === true,
  };
}

/** Resolves the caller's live N3 session from CompanyProfile/BasicInfo. Fails closed. */
export async function resolveN3Session(bearerToken: string): Promise<SessionResolution> {
  const upstream = await n3Get("main", BASIC_INFO_PATH, "", bearerToken);
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, message: "N3 session could not be resolved" };
  }
  if (upstream.status === 401) {
    return { ok: false, status: 401, message: "N3 rejected the session token" };
  }
  if (upstream.status === 403) {
    return { ok: false, status: 403, message: "N3 denied access for this session" };
  }
  if (upstream.status >= 400) {
    return { ok: false, status: 502, message: "N3 session could not be resolved" };
  }

  const envelope = upstream.body as { code?: string; success?: boolean; data?: unknown } | null;
  if (!envelope || (envelope.code !== "0000" && envelope.success !== true)) {
    return { ok: false, status: 502, message: "N3 session response was not understood" };
  }
  const session = normaliseBasicInfo(envelope.data);
  if (!session) {
    return { ok: false, status: 502, message: "N3 session response was not understood" };
  }
  return { ok: true, session };
}

export type BootstrapResult =
  | {
      ok: true;
      tenantRowId: string;
      role: "owner" | "unassigned";
      userPersisted: boolean;
      status: "provisioned" | "partial";
    }
  | { ok: false; reason: "missing_tenant_identity" | "database_error" };

/**
 * Upserts the tenant by immutable N3 tenant id and, when N3 supplies a stable
 * user id, the current user's ProjectHub role. Nothing here is ever taken from
 * the browser.
 */
export async function bootstrapProjectHub(
  session: N3Session,
  correlationId: string,
): Promise<BootstrapResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (!session.n3TenantId) {
    await writeAudit(correlationId, {
      tenantRowId: null,
      actor: session.n3UserId,
      eventType: "bootstrap",
      action: "tenant_upsert",
      outcome: "failed",
      metadata: { reason: "missing_tenant_identity" },
    });
    return { ok: false, reason: "missing_tenant_identity" };
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("projecthub_tenants")
    .upsert(
      {
        n3_tenant_id: session.n3TenantId,
        n3_tenant_code: session.tenantCode,
        company_name: session.companyName,
      },
      { onConflict: "n3_tenant_id" },
    )
    .select("id")
    .single();

  if (tenantError || !tenant) {
    await writeAudit(correlationId, {
      tenantRowId: null,
      actor: session.n3UserId,
      eventType: "bootstrap",
      action: "tenant_upsert",
      outcome: "failed",
      metadata: { reason: "database_error" },
    });
    return { ok: false, reason: "database_error" };
  }

  const role: "owner" | "unassigned" = session.isOwner ? "owner" : "unassigned";
  let userPersisted = false;
  let userExpected = false;

  // If N3 does not provide a stable user id, persist nothing for the user.
  if (session.n3UserId) {
    userExpected = true;
    const { error: roleError } = await supabaseAdmin.from("projecthub_user_roles").upsert(
      {
        tenant_id: tenant.id,
        n3_user_id: session.n3UserId,
        display_email: session.displayEmail,
        display_name: session.displayName,
        role,
        is_active: true,
      },
      { onConflict: "tenant_id,n3_user_id" },
    );
    userPersisted = !roleError;
  }

  // A failed user-role upsert is never reported as full success.
  const partial = userExpected && !userPersisted;
  await writeAudit(correlationId, {
    tenantRowId: tenant.id,
    actor: session.n3UserId,
    eventType: "bootstrap",
    action: "tenant_and_role_upsert",
    outcome: partial ? "partial" : "succeeded",
    targetType: "tenant",
    targetIdentity: session.n3TenantId,
    metadata: { role, userPersisted, userIdContract: session.n3UserId ? "present" : "missing" },
  });

  return {
    ok: true,
    tenantRowId: tenant.id,
    role,
    userPersisted,
    status: partial ? "partial" : "provisioned",
  };
}

export type TenantContext =
  | { ok: true; tenantRowId: string }
  | { ok: false; reason: "missing_tenant_identity" | "database_error" };

/**
 * Resolves the internal projecthub_tenants.id for a protected read. Identity
 * comes ONLY from the immutable N3 tenant id in the live BasicInfo response —
 * never from a URL, header, body, JWT claim, email, tenant code or any other
 * browser-supplied value.
 */
export async function resolveTenantRowId(session: N3Session): Promise<TenantContext> {
  if (!session.n3TenantId) return { ok: false, reason: "missing_tenant_identity" };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("projecthub_tenants")
      .upsert(
        {
          n3_tenant_id: session.n3TenantId,
          n3_tenant_code: session.tenantCode,
          company_name: session.companyName,
        },
        { onConflict: "n3_tenant_id" },
      )
      .select("id")
      .single();
    if (error || !data) return { ok: false, reason: "database_error" };
    return { ok: true, tenantRowId: data.id };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

export async function writeAudit(
  correlationId: string,
  event: {
    tenantRowId: string | null;
    actor: string | null;
    eventType: string;
    action: string;
    outcome: string;
    targetType?: string;
    targetIdentity?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("projecthub_integration_audit_events").insert({
      tenant_id: event.tenantRowId,
      actor_n3_user_id: event.actor,
      event_type: event.eventType,
      action: event.action,
      target_type: event.targetType ?? null,
      target_identity: event.targetIdentity ?? null,
      outcome: event.outcome,
      correlation_id: correlationId,
      metadata: (event.metadata ?? {}) as Json,
    });
  } catch {
    // Diagnostics must never break the request path.
  }
}

export async function writeDiagnostic(record: {
  tenantRowId: string | null;
  actor: string | null;
  correlationId: string;
  operationId: string;
  startedAt: string;
  endedAt: string;
  statusCode: number | null;
  outcome: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseBytes?: number | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("projecthub_n3_request_diagnostics").insert({
      tenant_id: record.tenantRowId,
      actor_n3_user_id: record.actor,
      correlation_id: record.correlationId,
      operation_id: record.operationId,
      http_method: "GET",
      started_at: record.startedAt,
      ended_at: record.endedAt,
      status_code: record.statusCode,
      outcome: record.outcome,
      error_code: record.errorCode ?? null,
      error_message: record.errorMessage ? record.errorMessage.slice(0, 500) : null,
      response_bytes: record.responseBytes ?? null,
    });
  } catch {
    // Diagnostics must never break the request path.
  }
}
