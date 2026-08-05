/**
 * Server-only N3 session resolution, real Owner enforcement and the ProjectHub
 * tenant/user bootstrap. This is the ONLY authority for tenant identity and the
 * Owner flag — never a client-decoded JWT claim.
 */
import type { Json } from "@/integrations/supabase/types";
import { BASIC_INFO_PATH } from "./n3-allowlist";
import { n3Get } from "./n3-api.server";
import { isProjectHubRole, type ProjectHubRole } from "./projecthub-rbac";

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

export type EffectiveRoleStatus =
  | "owner"
  | "assigned"
  | "unassigned"
  | "disabled"
  | "identity_missing";

export type BootstrapResult =
  | {
      ok: true;
      tenantRowId: string;
      role: ProjectHubRole;
      roleStatus: EffectiveRoleStatus;
      roleSource: string | null;
      userPersisted: boolean;
      status: "provisioned" | "partial";
    }
  | { ok: false; reason: "missing_tenant_identity" | "database_error" };

/**
 * Resolves the effective ProjectHub role for a live N3 session.
 *
 * Rules (see Milestone 1A):
 * - live BasicInfo.isOwner === true is the ONLY Owner authority;
 * - an Owner-assigned role for a non-Owner survives every session refresh;
 * - a stored `owner` row never elevates when live isOwner is false — it is
 *   repaired down to `unassigned`;
 * - a deactivated role row is denied.
 */
export async function resolveEffectiveRole(
  session: N3Session,
  tenantRowId: string,
): Promise<{
  role: ProjectHubRole;
  roleStatus: EffectiveRoleStatus;
  roleSource: string | null;
  persisted: boolean;
  attempted: boolean;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (!session.n3UserId) {
    return {
      role: "unassigned",
      roleStatus: "identity_missing",
      roleSource: null,
      persisted: false,
      attempted: false,
    };
  }

  const { data: existing, error: readError } = await supabaseAdmin
    .from("projecthub_user_roles")
    .select("role, is_active, role_source")
    .eq("tenant_id", tenantRowId)
    .eq("n3_user_id", session.n3UserId)
    .maybeSingle();

  if (readError) {
    return {
      role: "unassigned",
      roleStatus: "unassigned",
      roleSource: null,
      persisted: false,
      attempted: true,
    };
  }

  const display = { display_email: session.displayEmail, display_name: session.displayName };

  // Live Owner: always owner, and the stored row is kept consistent for audit.
  if (session.isOwner) {
    const { error } = await supabaseAdmin.from("projecthub_user_roles").upsert(
      {
        tenant_id: tenantRowId,
        n3_user_id: session.n3UserId,
        ...display,
        role: "owner",
        role_source: "n3_owner",
        is_active: true,
      },
      { onConflict: "tenant_id,n3_user_id" },
    );
    return {
      role: "owner",
      roleStatus: "owner",
      roleSource: "n3_owner",
      persisted: !error,
      attempted: true,
    };
  }

  // Non-Owner with no row yet: create the deny-by-default unassigned row.
  if (!existing) {
    const { error } = await supabaseAdmin.from("projecthub_user_roles").insert({
      tenant_id: tenantRowId,
      n3_user_id: session.n3UserId,
      ...display,
      role: "unassigned",
      role_source: "bootstrap_unassigned",
      is_active: true,
    });
    return {
      role: "unassigned",
      roleStatus: "unassigned",
      roleSource: "bootstrap_unassigned",
      persisted: !error,
      attempted: true,
    };
  }

  // Stale stored owner while live N3 says otherwise: repair, never elevate.
  if (existing.role === "owner") {
    const { error } = await supabaseAdmin
      .from("projecthub_user_roles")
      .update({
        ...display,
        role: "unassigned",
        role_source: "stale_owner_downgraded",
        is_active: true,
      })
      .eq("tenant_id", tenantRowId)
      .eq("n3_user_id", session.n3UserId);
    return {
      role: "unassigned",
      roleStatus: "unassigned",
      roleSource: "stale_owner_downgraded",
      persisted: !error,
      attempted: true,
    };
  }

  // Assigned role is preserved. Only safe display attributes are refreshed.
  const { error } = await supabaseAdmin
    .from("projecthub_user_roles")
    .update(display)
    .eq("tenant_id", tenantRowId)
    .eq("n3_user_id", session.n3UserId);

  const stored = isProjectHubRole(existing.role) ? existing.role : "unassigned";
  const roleStatus: EffectiveRoleStatus = !existing.is_active
    ? "disabled"
    : stored === "unassigned"
      ? "unassigned"
      : "assigned";

  return {
    role: existing.is_active ? stored : "unassigned",
    roleStatus,
    roleSource: existing.role_source ?? null,
    persisted: !error,
    attempted: true,
  };
}

/**
 * Upserts the tenant by immutable N3 tenant id and resolves/persists the
 * caller's effective ProjectHub role. Nothing here is ever taken from the
 * browser.
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

  const resolved = await resolveEffectiveRole(session, tenant.id);

  // A failed EXPECTED user-role write is never reported as full success.
  const partial = resolved.attempted && !resolved.persisted;
  await writeAudit(correlationId, {
    tenantRowId: tenant.id,
    actor: session.n3UserId,
    eventType: "bootstrap",
    action: "tenant_and_role_upsert",
    outcome: partial ? "partial" : "succeeded",
    targetType: "tenant",
    targetIdentity: session.n3TenantId,
    metadata: {
      role: resolved.role,
      roleStatus: resolved.roleStatus,
      userPersisted: resolved.persisted,
      userIdContract: session.n3UserId ? "present" : "missing",
    },
  });

  return {
    ok: true,
    tenantRowId: tenant.id,
    role: resolved.role,
    roleStatus: resolved.roleStatus,
    roleSource: resolved.roleSource,
    userPersisted: resolved.persisted,
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
