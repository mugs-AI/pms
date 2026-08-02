/**
 * Same-origin N3 boundary. Every request is validated against the server-owned
 * allowlist, then authorised against the LIVE N3 session before any upstream
 * fetch happens. GET only — this milestone performs no N3 writes.
 */
import { resolveOperation, validateBearer, validateQuery } from "./n3-allowlist";
import { n3Get, newCorrelationId } from "./n3-api.server";
import {
  bootstrapProjectHub,
  resolveN3Session,
  resolveTenantRowId,
  writeDiagnostic,
  type N3Session,
} from "./n3-session.server";

function jsonError(status: number, message: string, correlationId: string) {
  return Response.json(
    { code: "PROXY", success: false, message, correlationId },
    { status, headers: { "x-correlation-id": correlationId } },
  );
}

export function methodNotAllowed() {
  const correlationId = newCorrelationId();
  return Response.json(
    { code: "PROXY", success: false, message: "Method not allowed", correlationId },
    { status: 405, headers: { Allow: "GET", "x-correlation-id": correlationId } },
  );
}

/** Safe session DTO returned to the browser. Contains no token material. */
export type SessionDto = {
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
  displayName: string | null;
  isOwner: boolean;
  hasTenantIdentity: boolean;
  hasUserIdentity: boolean;
  correlationId: string;
};

function toDto(session: N3Session, correlationId: string): SessionDto {
  return {
    companyName: session.companyName,
    tenantCode: session.tenantCode,
    email: session.displayEmail,
    displayName: session.displayName,
    isOwner: session.isOwner,
    hasTenantIdentity: Boolean(session.n3TenantId),
    hasUserIdentity: Boolean(session.n3UserId),
    correlationId,
  };
}

/** GET /api/public/n3/session — resolves the live N3 session and bootstraps ProjectHub. */
export async function handleSessionRequest(request: Request): Promise<Response> {
  const correlationId = newCorrelationId();
  const bearer = validateBearer(request.headers.get("authorization"));
  if (!bearer.ok) return jsonError(401, "A valid bearer token is required", correlationId);

  const resolved = await resolveN3Session(bearer.token);
  if (!resolved.ok) return jsonError(resolved.status, resolved.message, correlationId);

  const bootstrap = await bootstrapProjectHub(resolved.session, correlationId);
  const dto = toDto(resolved.session, correlationId);

  return Response.json(
    {
      code: "0000",
      success: true,
      data: {
        ...dto,
        provisioning:
          bootstrap.ok === true
            ? {
                status: "provisioned",
                role: bootstrap.role,
                userPersisted: bootstrap.userPersisted,
              }
            : { status: "unprovisioned", reason: bootstrap.reason },
      },
    },
    { headers: { "x-correlation-id": correlationId } },
  );
}

/** GET /api/public/n3/<target>/<allowlisted path> */
export async function handleN3ProxyRequest(request: Request, splat: string): Promise<Response> {
  const correlationId = newCorrelationId();
  const startedAt = new Date().toISOString();

  const resolvedPath = resolveOperation(splat);
  if (!resolvedPath.ok) return jsonError(404, "Not found", correlationId);
  const operation = resolvedPath.operation;

  const bearer = validateBearer(request.headers.get("authorization"));
  if (!bearer.ok) return jsonError(401, "A valid bearer token is required", correlationId);

  const url = new URL(request.url);
  const query = validateQuery(operation, url.searchParams);
  if (!query.ok) return jsonError(400, "Unsupported query for this operation", correlationId);

  let session: N3Session | null = null;
  let tenantRowId: string | null = null;
  if (operation.ownerRequired) {
    const resolvedSession = await resolveN3Session(bearer.token);
    if (!resolvedSession.ok) {
      return jsonError(resolvedSession.status, resolvedSession.message, correlationId);
    }
    session = resolvedSession.session;

    // Tenant context must exist BEFORE the requested dataset is called, and is
    // derived only from the live BasicInfo immutable tenant id.
    const tenant = await resolveTenantRowId(session);
    if (!tenant.ok) {
      return jsonError(503, "Tenant context could not be established", correlationId);
    }
    tenantRowId = tenant.tenantRowId;

    if (session.isOwner !== true) {
      await writeDiagnostic({
        tenantRowId,
        actor: session.n3UserId,
        correlationId,
        operationId: operation.id,
        startedAt,
        endedAt: new Date().toISOString(),
        statusCode: 403,
        outcome: "denied",
        errorCode: "not_owner",
      });
      return jsonError(403, "This read is limited to the N3 account owner", correlationId);
    }
  }

  const upstream = await n3Get("main", operation.path, query.search, bearer.token);
  const endedAt = new Date().toISOString();

  if (!upstream.ok) {
    await writeDiagnostic({
      tenantRowId,
      actor: session?.n3UserId ?? null,
      correlationId,
      operationId: operation.id,
      startedAt,
      endedAt,
      statusCode: upstream.status,
      outcome: upstream.outcome,
      errorCode: upstream.outcome,
    });
    return jsonError(upstream.status, "N3 Open API could not be read", correlationId);
  }

  await writeDiagnostic({
    tenantRowId,
    actor: session?.n3UserId ?? null,
    correlationId,
    operationId: operation.id,
    startedAt,
    endedAt,
    statusCode: upstream.status,
    outcome: upstream.status >= 400 ? "upstream_error" : "succeeded",
    responseBytes: upstream.bytes,
  });

  return Response.json(upstream.body, {
    status: upstream.status,
    headers: { "x-correlation-id": correlationId },
  });
}
