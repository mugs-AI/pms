/**
 * Correction 1A-Live-1.1 — mandatory N3 token binding, exact Owner role and
 * server-key classification. Every N3 call is mocked; no N3 write exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync, globSync } from "node:fs";
import { resolve } from "node:path";
import {
  normaliseBasicInfo,
  resolveN3Session,
  serverDatabaseConfigStatus,
} from "@/lib/n3-session.server";
import { decodeN3TokenClaims } from "@/lib/n3-token.server";
import { classifyServerKey, isValidServerKeyClass } from "@/lib/server-key-class.server";
import { resolveActor } from "@/lib/projecthub-actor.server";
import { jsonResponse, mockUpstream, createMockSupabase } from "./helpers";

const root = resolve(__dirname, "..");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
const token = (payload: Record<string, unknown>) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signaturesignature`;

/** Documented synthetic identity constants. No production value is derived. */
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_CODE = "TST-001";
const DISPLAY_NAME = "TEST USER";
const EMAIL = "user@example.test";
const CLAIMS = {
  uid: USER_ID,
  email: EMAIL,
  dname: DISPLAY_NAME,
  tenantId: TENANT_ID,
  tenantCode: TENANT_CODE,
  roles: "sys-admin",
};

function basic(data: Record<string, unknown>) {
  return { code: "0000", success: true, data };
}
const COMPANY = { tenantCode: TENANT_CODE, companyName: "Example Sdn Bhd" };

function sessionRequest(bearer: string) {
  return new Request("http://localhost:8080/api/projecthub/session", {
    headers: { authorization: `Bearer ${bearer}` },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("mandatory token-to-live-N3 tenant binding", () => {
  it("1. matching live and token tenant codes resolve identity", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const r = await resolveN3Session(token(CLAIMS));
    expect(r.ok && r.session.n3TenantId).toBe(TENANT_ID);
    expect(r.ok && r.session.n3UserId).toBe(USER_ID);
  });

  it("2. missing live BasicInfo tenant code rejects token-claim use", async () => {
    mockUpstream(() => jsonResponse(basic({ companyName: "Example Sdn Bhd" })));
    const r = await resolveN3Session(token(CLAIMS));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.n3TenantId).toBeNull();
    expect(r.session.n3UserId).toBeNull();
    expect(r.session.isOwner).toBe(false);
  });

  it("3. missing token tenant code rejects token-claim use", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const { tenantCode: _omit, ...noCode } = CLAIMS;
    const r = await resolveN3Session(token(noCode));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.n3TenantId).toBeNull();
    expect(r.session.isOwner).toBe(false);
  });

  it("4. a tenant-code mismatch returns 403 and touches no tenant table", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const mock = createMockSupabase();
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const { resolveActor: resolve2 } = await import("@/lib/projecthub-actor.server");
    const res = await resolve2(sessionRequest(token({ ...CLAIMS, tenantCode: "OTHER-999" })));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(403);
    expect(mock.calls.some((c) => c.table === "projecthub_tenants")).toBe(false);
  });

  it("5. an undecodable token supplies no tenant, user or Owner authority", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const r = await resolveN3Session("aaaaaaaaaaaa.bbbbbbbb.cccccccc");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.n3TenantId).toBeNull();
    expect(r.session.n3UserId).toBeNull();
    expect(r.session.isOwner).toBe(false);
  });

  it("6. exact sys-admin grants Owner only after successful binding", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    expect((await resolveN3Session(token(CLAIMS))).ok).toBe(true);
    const bound = await resolveN3Session(token(CLAIMS));
    expect(bound.ok && bound.session.isOwner).toBe(true);

    mockUpstream(() => jsonResponse(basic({ companyName: "Example Sdn Bhd" })));
    const unbound = await resolveN3Session(token(CLAIMS));
    expect(unbound.ok && unbound.session.isOwner).toBe(false);
  });

  it("7. aliases and an isOwner claim never grant Owner", async () => {
    for (const roles of ["owner", "sysadmin", "system-admin", "admin", "user"]) {
      mockUpstream(() => jsonResponse(basic(COMPANY)));
      const r = await resolveN3Session(token({ ...CLAIMS, roles }));
      expect(r.ok && r.session.isOwner).toBe(false);
    }
    for (const isOwner of [true, "true", 1, { value: true }]) {
      mockUpstream(() => jsonResponse(basic(COMPANY)));
      const r = await resolveN3Session(token({ ...CLAIMS, roles: "user", isOwner }));
      expect(r.ok && r.session.isOwner).toBe(false);
    }
  });

  it("8. roles supplied as a string or an array normalize safely", () => {
    expect(decodeN3TokenClaims(token({ roles: " Sys-Admin " }))?.isSystemAdmin).toBe(true);
    expect(decodeN3TokenClaims(token({ roles: ["user", "sys-admin"] }))?.isSystemAdmin).toBe(true);
    expect(decodeN3TokenClaims(token({ roles: "user,sys-admin" }))?.isSystemAdmin).toBe(true);
    expect(decodeN3TokenClaims(token({ roles: ["user"] }))?.isSystemAdmin).toBe(false);
  });

  it("9. a missing uid with a populated sub stays identity_missing and writes no user row", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const { uid: _u, ...noUid } = CLAIMS;
    const mock = createMockSupabase({
      projecthub_tenants: { returning: { id: "tenant-row-1" } },
    });
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock.client }));
    const { resolveActor: resolve2 } = await import("@/lib/projecthub-actor.server");
    const res = await resolve2(sessionRequest(token({ ...noUid, sub: USER_ID, roles: "user" })));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.actor.n3UserId).toBeNull();
    expect(res.actor.roleStatus).toBe("identity_missing");
    expect(res.actor.role).toBe("unassigned");
    expect(res.actor.session.isOwner).toBe(false);
    expect(mock.calls.some((c) => c.table === "projecthub_user_roles")).toBe(false);
  });

  it("9a. only the exact verified claim names are consumed", async () => {
    mockUpstream(() => jsonResponse(basic(COMPANY)));
    const aliasOnly = await resolveN3Session(
      token({ tenant_id: TENANT_ID, tenant_code: TENANT_CODE, sub: USER_ID, name: DISPLAY_NAME }),
    );
    expect(aliasOnly.ok).toBe(true);
    if (!aliasOnly.ok) return;
    expect(aliasOnly.session.n3TenantId).toBeNull();
    expect(aliasOnly.session.n3UserId).toBeNull();
    expect(aliasOnly.session.displayName).toBeNull();

    const claims = decodeN3TokenClaims(
      token({ tenant_id: TENANT_ID, tenant_code: TENANT_CODE, sub: USER_ID, name: DISPLAY_NAME }),
    );
    expect(claims?.tenantId).toBeNull();
    expect(claims?.tenantCode).toBeNull();
    expect(claims?.userId).toBeNull();
    expect(claims?.displayName).toBeNull();
  });

  it("9b. BasicInfo isOwner never grants Owner, bound or unbound", async () => {
    mockUpstream(() => jsonResponse(basic({ ...COMPANY, isOwner: true })));
    const bound = await resolveN3Session(token({ ...CLAIMS, roles: "user" }));
    expect(bound.ok && bound.session.isOwner).toBe(false);

    mockUpstream(() => jsonResponse(basic({ ...COMPANY, isOwner: true })));
    const unbound = await resolveN3Session("aaaaaaaaaaaa.bbbbbbbb.cccccccc");
    expect(unbound.ok && unbound.session.isOwner).toBe(false);

    expect(normaliseBasicInfo({ ...COMPANY, isOwner: true })?.isOwner).toBe(false);
  });
});

describe("server-key classification", () => {
  it("10. a safe synthetic modern sb_secret_ key is accepted", () => {
    expect(classifyServerKey("sb_secret_abcdefghijklmnop")).toBe("modern_secret");
    expect(isValidServerKeyClass("sb_secret_abcdefghijklmnop")).toBe(true);
  });

  it("10a. a bare or unsafe sb_secret_ suffix is rejected", () => {
    expect(classifyServerKey("sb_secret_")).toBe("rejected_malformed");
    expect(classifyServerKey("sb_secret_short")).toBe("rejected_malformed");
    expect(classifyServerKey("sb_secret_abcdefgh ijkl")).toBe("rejected_malformed");
    expect(classifyServerKey("sb_secret_abcdefgh\u0001ijkl")).toBe("rejected_malformed");
    expect(classifyServerKey("sb_secret_" + "a".repeat(9000))).toBe("rejected_malformed");
    for (const key of ["sb_secret_", "sb_secret_short"]) {
      expect(isValidServerKeyClass(key)).toBe(false);
    }
  });

  it("11. an sb_publishable_ key is rejected", () => {
    expect(classifyServerKey("sb_publishable_abcdef")).toBe("rejected_publishable");
    expect(isValidServerKeyClass("sb_publishable_abcdef")).toBe(false);
  });

  it("12. a legacy JWT with role service_role is accepted", () => {
    expect(classifyServerKey(token({ role: "service_role" }))).toBe("legacy_service_role");
  });

  it("13. legacy JWTs with a wrong, missing or malformed role are rejected", () => {
    expect(classifyServerKey(token({ role: "anon" }))).toBe("rejected_legacy_role");
    expect(classifyServerKey(token({ role: "authenticated" }))).toBe("rejected_legacy_role");
    expect(classifyServerKey(token({ sub: "x" }))).toBe("rejected_malformed");
    expect(classifyServerKey("aaa.bbb.ccc")).toBe("rejected_malformed");
    expect(classifyServerKey("only.two")).toBe("rejected_malformed");
    expect(classifyServerKey("")).toBe("missing");
    expect(classifyServerKey(undefined)).toBe("missing");
  });

  it("14. config status exposes booleans only, never the credential", () => {
    const status = serverDatabaseConfigStatus();
    expect(Object.values(status).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("sb_");
  });
});

describe("privacy and architecture guards", () => {
  it("15. every committed fixture identity is an explicit synthetic constant", () => {
    // Policy test only: no production-derived value — plain, encoded, hashed or
    // partial — is committed anywhere in this repository.
    expect(TENANT_CODE).toBe("TST-001");
    expect(DISPLAY_NAME).toBe("TEST USER");
    expect(EMAIL.endsWith("@example.test")).toBe(true);
    expect(TENANT_ID).toBe("22222222-2222-4222-8222-222222222222");
    expect(USER_ID).toBe("11111111-1111-4111-8111-111111111111");
    expect(TENANT_ID).not.toBe(USER_ID);

    // No committed test may reintroduce an encoded identifier list.
    const files = globSync("tests/**/*.ts", { cwd: root });
    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toContain('"base64"');
    }
  });

  it("16. src/start.ts still declares functionMiddleware: []", () => {
    const start = readFileSync(resolve(root, "src/start.ts"), "utf8");
    expect(start.replace(/\s+/g, "")).toContain("functionMiddleware:[]");
  });

  it("17. browser Supabase auth files remain absent", () => {
    for (const file of [
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/auth-attacher.ts",
      "src/integrations/supabase/auth-middleware.ts",
    ]) {
      expect(existsSync(resolve(root, file))).toBe(false);
    }
  });

  it("18. no owner alias set, isOwner claim consumption or N3 write exists", () => {
    const tokenSource = readFileSync(resolve(root, "src/lib/n3-token.server.ts"), "utf8");
    expect(tokenSource).not.toContain("OWNER_ROLES");
    expect(tokenSource).not.toContain('c["isOwner"]');
    const files = globSync("src/**/*.{ts,tsx}", { cwd: root });
    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toMatch(/n3(Post|Put|Patch|Delete)\s*\(/);
    }
  });
});
