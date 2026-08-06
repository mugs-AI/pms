/**
 * The single ProjectHub business authority.
 *
 * Every ProjectHub API request resolves the actor here BEFORE any database or
 * N3 work happens. Tenant identity and Owner authority come only from live
 * `CompanyProfile/BasicInfo`; the browser can never supply, hint at or
 * override them.
 */
import { validateBearer } from "./n3-allowlist";
import { newCorrelationId } from "./n3-api.server";
import {
  resolveEffectiveRole,
  resolveN3Session,
  resolveTenantRowId,
  writeAudit,
  type EffectiveRoleStatus,
  type N3Session,
} from "./n3-session.server";
import {
  permissionsForRole,
  roleHasPermission,
  ROLE_LABELS,
  type Permission,
  type ProjectHubRole,
} from "./projecthub-rbac";

/** Browser-supplied tenant hints are rejected outright, never merely ignored. */
export const FORBIDDEN_TENANT_HEADERS = [
  "x-tenant-id",
  "x-company-id",
  "x-n3-tenant-id",
  "x-projecthub-tenant",
];
export const FORBIDDEN_TENANT_KEYS = [
  "tenantId",
  "tenant_id",
  "n3TenantId",
  "n3_tenant_id",
  "companyId",
  "company_id",
];

export type Actor = {
  correlationId: string;
  bearer: string;
  session: N3Session;
  tenantRowId: string;
  n3UserId: string | null;
  role: ProjectHubRole;
  roleStatus: EffectiveRoleStatus;
  permissions: Permission[];
};

export function jsonResponse(body: unknown, status: number, correlationId: string) {
  return Response.json(body, {
    status,
    headers: { "x-correlation-id": correlationId },
  });
}

export function ok(data: unknown, correlationId: string, status = 200) {
  return jsonResponse({ code: "0000", success: true, data }, status, correlationId);
}

export function fail(status: number, message: string, correlationId: string, extra?: unknown) {
  return jsonResponse(
    { code: "PROJECTHUB", success: false, message, correlationId, details: extra ?? undefined },
    status,
    correlationId,
  );
}

export function methodNotAllowed(correlationId: string, allow: string) {
  return Response.json(
    { code: "PROJECTHUB", success: false, message: "Method not allowed", correlationId },
    { status: 405, headers: { Allow: allow, "x-correlation-id": correlationId } },
  );
}

export type ActorResolution =
  { ok: true; actor: Actor } | { ok: false; response: Response; correlationId: string };

/**
 * Steps 1-7 of the request contract: correlation id, bearer validation, live
 * N3 identity, immutable tenant/user identity, internal tenant row, effective
 * role and permissions.
 */
export async function resolveActor(
  request: Request,
  correlationId = newCorrelationId(),
): Promise<ActorResolution> {
  for (const header of FORBIDDEN_TENANT_HEADERS) {
    if (request.headers.get(header) !== null) {
      return {
        ok: false,
        correlationId,
        response: fail(400, "Tenant context cannot be supplied by the client", correlationId),
      };
    }
  }

  const bearer = validateBearer(request.headers.get("authorization"));
  if (!bearer.ok) {
    return {
      ok: false,
      correlationId,
      response: fail(401, "A valid bearer token is required", correlationId),
    };
  }

  const resolved = await resolveN3Session(bearer.token);
  if (!resolved.ok) {
    const status = resolved.status === 401 ? 401 : resolved.status === 403 ? 403 : 502;
    return {
      ok: false,
      correlationId,
      response: fail(status, "The N3 session could not be resolved", correlationId),
    };
  }
  const session = resolved.session;

  if (!session.n3TenantId) {
    return {
      ok: false,
      correlationId,
      response: fail(503, "Tenant context could not be established", correlationId),
    };
  }

  const tenant = await resolveTenantRowId(session);
  if (!tenant.ok) {
    return {
      ok: false,
      correlationId,
      response: fail(503, "Tenant context could not be established", correlationId),
    };
  }

  const effective = await resolveEffectiveRole(session, tenant.tenantRowId);

  return {
    ok: true,
    actor: {
      correlationId,
      bearer: bearer.token,
      session,
      tenantRowId: tenant.tenantRowId,
      n3UserId: session.n3UserId,
      role: effective.role,
      roleStatus: effective.roleStatus,
      permissions: permissionsForRole(effective.role),
    },
  };
}

/** Step 8: the operation-specific permission gate. Always server-side. */
export function requirePermission(actor: Actor, permission: Permission): Response | null {
  if (actor.roleStatus === "identity_missing") {
    return fail(
      403,
      "N3 did not supply a stable user identity for this session",
      actor.correlationId,
    );
  }
  if (actor.roleStatus === "disabled") {
    return fail(403, "This ProjectHub access has been deactivated", actor.correlationId);
  }
  if (!roleHasPermission(actor.role, permission)) {
    return fail(403, "Your ProjectHub role does not allow this action", actor.correlationId);
  }
  return null;
}

export function actorSessionDto(actor: Actor) {
  return {
    companyName: actor.session.companyName,
    tenantCode: actor.session.tenantCode,
    email: actor.session.displayEmail,
    displayName: actor.session.displayName,
    isOwner: actor.session.isOwner,
    hasTenantIdentity: true,
    hasUserIdentity: Boolean(actor.n3UserId),
    projectHubRole: actor.role,
    roleLabel: ROLE_LABELS[actor.role],
    roleStatus: actor.roleStatus,
    permissions: actor.permissions,
    correlationId: actor.correlationId,
  };
}

export async function auditAction(
  actor: Actor,
  event: {
    eventType: string;
    action: string;
    outcome: string;
    targetType?: string;
    targetIdentity?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await writeAudit(actor.correlationId, {
    tenantRowId: actor.tenantRowId,
    actor: actor.n3UserId,
    ...event,
  });
}

/** Rejects a body that tries to smuggle tenant authority. */
export function hasForbiddenTenantKeys(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return FORBIDDEN_TENANT_KEYS.some((key) => key in (body as Record<string, unknown>));
}
