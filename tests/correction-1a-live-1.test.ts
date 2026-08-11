/**
 * Correction 1A-Live-1 — production tenant-bootstrap regression coverage.
 * Every N3 call is mocked; no live N3 read or write happens here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyTenantDbError,
  normaliseBasicInfo,
  resolveN3Session,
  resolveTenantRowId,
  serverDatabaseConfigStatus,
} from "@/lib/n3-session.server";
import { decodeN3TokenClaims } from "@/lib/n3-token.server";
import { resolveActor } from "@/lib/projecthub-actor.server";
import { jsonResponse, mockUpstream, createMockSupabase } from "./helpers";

const root = resolve(__dirname, "..");

/** Mints an unsigned token payload in the real production claim shape. */
function token(payload: Record<string, unknown>) {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signaturesignature`;
}

const TEST_CLAIMS = {
  sub: "00000000-0000-4000-8000-00000000user",
  uid: "00000000-0000-4000-8000-00000000user",
  email: "user@example.test",
  dname: "TEST USER",
  tenantId: "00000000-0000-4000-8000-0000000tenant",
  tenantCode: "TST-001",
  roles: "sys-admin",
};

/** The REAL production BasicInfo contract: company attributes only. */
function syntheticBasicInfo() {
  return {
    code: "0000",
    success: true,
    data: {
      tenantCode: "TST-001",
      companyName: "Example Sdn Bhd",
      registrationNumber: "X",
      lhdnConnected: false,
    },
  };
}

function sessionRequest(bearer: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:8080/api/projecthub/session", {
    headers: { authorization: `Bearer ${bearer}`, ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("root cause: production BasicInfo carries no immutable tenant id", () => {
  it("1. reproduces the incident — BasicInfo alone yields no tenant identity", () => {
    const normalised = normaliseBasicInfo(syntheticBasicInfo().data);
    expect(normalised?.n3TenantId).toBeNull();
    expect(normalised?.isOwner).toBe(false);
  });

  it("2. the verified N3 token supplies the immutable identity shape", () => {
    const claims = decodeN3TokenClaims(token(TEST_CLAIMS));
    expect(claims?.tenantId).toBe(TEST_CLAIMS.tenantId);
    expect(claims?.userId).toBe(TEST_CLAIMS.uid);
    expect(claims?.tenantCode).toBe(TEST_CLAIMS.tenantCode);
    expect(claims?.isSystemAdmin).toBe(true);
  });

  it("3. `isOwner` is never read from a token claim", () => {
    const claims = decodeN3TokenClaims(token({ isOwner: "true", tenantCode: "EVIL" }));
    expect(claims?.isSystemAdmin).toBe(false);
    expect(claims && "isOwner" in claims).toBe(false);
  });

  it("4. the corrected session resolves tenant identity for the production shape", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const resolved = await resolveN3Session(token(TEST_CLAIMS));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.session.n3TenantId).toBe(TEST_CLAIMS.tenantId);
    expect(resolved.session.companyName).toBe("Example Sdn Bhd");
    expect(resolved.session.isOwner).toBe(true);
  });

  it("5. BasicInfo identity still wins when the legacy contract supplies it", async () => {
    mockUpstream(() =>
      jsonResponse({
        code: "0000",
        success: true,
        data: { tenantId: "legacy-tenant", tenantCode: "TST-001", isOwner: false },
      }),
    );
    const resolved = await resolveN3Session(token(TEST_CLAIMS));
    expect(resolved.ok && resolved.session.n3TenantId).toBe("legacy-tenant");
  });

  it("6. a token bound to a different tenantCode is rejected, never merged", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const resolved = await resolveN3Session(token({ ...TEST_CLAIMS, tenantCode: "EVIL" }));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.status).toBe(403);
  });

  it("7. with no tenant identity anywhere the session fails closed before any database work", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const mock = createMockSupabase();
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const res = await resolveActor(sessionRequest("aaaaaaaaaaaa.bbbbbbbb.cccccccc"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(503);
    expect(mock.calls.some((c) => c.table === "projecthub_tenants")).toBe(false);
  });
});

describe("tenant bootstrap classification and safe responses", () => {
  it("8. a resolved tenant row becomes the actor tenant context", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const mock = createMockSupabase({
      projecthub_tenants: { returning: { id: "tenant-row-1" } },
      projecthub_user_roles: { rows: [], returning: null },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const { resolveActor: resolve2 } = await import("@/lib/projecthub-actor.server");
    const res = await resolve2(sessionRequest(token(TEST_CLAIMS)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.actor.tenantRowId).toBe("tenant-row-1");
    expect(res.actor.role).toBe("owner");
  });

  it("9. classifies database failures into the approved internal classes", () => {
    expect(classifyTenantDbError({ code: "42P01" })).toBe("tenant_table_missing");
    expect(classifyTenantDbError({ code: "42501" })).toBe("tenant_permission_denied");
    expect(classifyTenantDbError({ code: "23505" })).toBe("tenant_upsert_failed");
    expect(classifyTenantDbError(null)).toBe("unexpected_database_failure");
  });

  it("10. missing server configuration is classified, never worked around", async () => {
    const url = process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_URL"];
    const result = await resolveTenantRowId({
      n3TenantId: TEST_CLAIMS.tenantId,
      tenantCode: "TST-001",
      companyName: "Example Sdn Bhd",
      n3UserId: TEST_CLAIMS.uid,
      displayEmail: null,
      displayName: null,
      isOwner: true,
    });
    if (url) process.env["SUPABASE_URL"] = url;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classification).toBe("database_configuration_missing");
  });

  it("11. configuration status reports presence/class only, never values", () => {
    const status = serverDatabaseConfigStatus();
    expect(Object.values(status).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("12. a bootstrap failure returns a generic 503 with a correlation id only", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const mock = createMockSupabase({
      projecthub_tenants: { error: { message: "relation does not exist" } },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const { resolveActor: resolve2 } = await import("@/lib/projecthub-actor.server");
    const res = await resolve2(sessionRequest(token(TEST_CLAIMS)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(503);
    const body = (await res.response.json()) as Record<string, unknown>;
    expect(body["message"]).toBe("Tenant context could not be established");
    expect(typeof body["correlationId"]).toBe("string");
    const text = JSON.stringify(body);
    for (const secret of [
      TEST_CLAIMS.tenantId,
      TEST_CLAIMS.uid,
      TEST_CLAIMS.email,
      "Example Sdn Bhd",
      "relation does not exist",
      "sb_secret",
      "supabase.co",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("13. audit diagnostics stay free of secrets, payloads and raw database text", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const mock = createMockSupabase({
      projecthub_tenants: { error: { message: "permission denied for table" } },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const { resolveActor: resolve2 } = await import("@/lib/projecthub-actor.server");
    await resolve2(sessionRequest(token(TEST_CLAIMS)));
    const audits = mock.calls.filter((c) => c.table === "projecthub_integration_audit_events");
    expect(audits.length).toBeGreaterThan(0);
    const text = JSON.stringify(audits);
    for (const secret of [
      TEST_CLAIMS.tenantId,
      TEST_CLAIMS.email,
      "Example Sdn Bhd",
      "permission denied for table",
      "Bearer",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("classification");
  });

  it("14. a browser-supplied tenant header is rejected outright", async () => {
    mockUpstream(() => jsonResponse(syntheticBasicInfo()));
    const res = await resolveActor(
      sessionRequest(token(TEST_CLAIMS), { "x-tenant-id": "99999999-9999-9999-9999-999999999999" }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(400);
  });
});

describe("architecture guards remain intact", () => {
  it("15. src/start.ts still declares functionMiddleware: []", () => {
    const start = readFileSync(resolve(root, "src/start.ts"), "utf8");
    expect(start.replace(/\s+/g, "")).toContain("functionMiddleware:[]");
  });

  it("16. no browser Supabase auth files exist", () => {
    for (const file of [
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/auth-attacher.ts",
      "src/integrations/supabase/auth-middleware.ts",
    ]) {
      expect(existsSync(resolve(root, file))).toBe(false);
    }
  });

  it("17. the token reader is server-only and never imported by browser code", async () => {
    const { globSync } = await import("node:fs");
    const files = globSync("src/**/*.{ts,tsx}", { cwd: root }).filter(
      (f) => !f.endsWith(".server.ts") && !f.startsWith("src/integrations"),
    );
    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toContain("n3-token.server");
      expect(source).not.toContain("client.server");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});
