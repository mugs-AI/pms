import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basicInfo, jsonResponse, mockUpstream, OWNER_TOKEN, USER_TOKEN } from "./helpers";

type Call = { table: string; op: string; row: unknown };
const dbCalls: Call[] = [];
const failures = { tenant: false, role: false };

vi.mock("@/integrations/supabase/client.server", () => {
  const makeChain = (table: string) => ({
    select() {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
      };
      return chain;
    },
    upsert(row: unknown) {
      dbCalls.push({ table, op: "upsert", row });
      const failed =
        (table === "projecthub_tenants" && failures.tenant) ||
        (table === "projecthub_user_roles" && failures.role);
      const result = {
        data: failed ? null : { id: "tenant-row-1" },
        error: failed ? { message: "db down" } : null,
      };
      return {
        select: () => ({ single: async () => result }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
    },
    async insert(row: unknown) {
      dbCalls.push({ table, op: "insert", row });
      return { error: null };
    },
  });
  return { supabaseAdmin: { from: (table: string) => makeChain(table) } };
});

const { handleN3ProxyRequest, handleSessionRequest } = await import("@/lib/n3-proxy.server");

const BASE = "http://localhost:8080/api/public/n3/";
const PATH = "main/api/Customers/List";

function get(path: string, token: string | null = OWNER_TOKEN, url = `${BASE}${path}`) {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request(url, { headers });
}

function diagnostics() {
  return dbCalls.filter((c) => c.table === "projecthub_n3_request_diagnostics");
}

beforeEach(() => {
  dbCalls.length = 0;
  failures.tenant = false;
  failures.role = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("tenant-scoped diagnostics", () => {
  it("a successful protected read writes a diagnostic with the internal tenant row id", async () => {
    mockUpstream((url) =>
      url.includes("BasicInfo")
        ? jsonResponse(basicInfo({ isOwner: true }))
        : jsonResponse({ code: "0000", success: true, data: { value: [], count: 0 } }),
    );
    const res = await handleN3ProxyRequest(get(PATH), PATH);
    expect(res.status).toBe(200);
    const diag = diagnostics();
    expect(diag).toHaveLength(1);
    expect((diag[0]!.row as { tenant_id: string }).tenant_id).toBe("tenant-row-1");
    expect((diag[0]!.row as { outcome: string }).outcome).toBe("succeeded");
  });

  it("non-owner denial diagnostics are tenant-scoped", async () => {
    mockUpstream(() => jsonResponse(basicInfo({ isOwner: false })));
    const res = await handleN3ProxyRequest(get(PATH, USER_TOKEN), PATH);
    expect(res.status).toBe(403);
    const diag = diagnostics();
    expect((diag[0]!.row as { tenant_id: string }).tenant_id).toBe("tenant-row-1");
  });

  it("upstream error and timeout diagnostics are tenant-scoped", async () => {
    mockUpstream((url) =>
      url.includes("BasicInfo")
        ? jsonResponse(basicInfo())
        : new Response("<html>bad</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
    );
    expect((await handleN3ProxyRequest(get(PATH), PATH)).status).toBe(502);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        if (String(input).includes("BasicInfo")) return jsonResponse(basicInfo());
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    expect((await handleN3ProxyRequest(get(PATH), PATH)).status).toBe(504);

    const diag = diagnostics();
    expect(diag).toHaveLength(2);
    for (const d of diag) {
      expect((d.row as { tenant_id: string }).tenant_id).toBe("tenant-row-1");
    }
  });

  it("a browser-supplied tenant id cannot influence tenant selection", async () => {
    mockUpstream((url) =>
      url.includes("BasicInfo")
        ? jsonResponse(basicInfo())
        : jsonResponse({ code: "0000", success: true, data: { value: [], count: 0 } }),
    );
    const req = new Request(`${BASE}${PATH}?$top=5`, {
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        "x-tenant-id": "99999999-9999-9999-9999-999999999999",
      },
    });
    await handleN3ProxyRequest(req, PATH);
    const upsert = dbCalls.find((c) => c.table === "projecthub_tenants");
    expect((upsert?.row as { n3_tenant_id: string }).n3_tenant_id).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("missing tenant identity prevents the requested N3 dataset call", async () => {
    const up = mockUpstream(() =>
      jsonResponse(
        basicInfo({ tenantId: undefined, id: undefined, dbId: undefined, tenantGuid: undefined }),
      ),
    );
    const res = await handleN3ProxyRequest(get(PATH), PATH);
    expect(res.status).toBe(503);
    expect(up.calls.every((u) => u.includes("BasicInfo"))).toBe(true);
    expect(await res.text()).not.toContain(OWNER_TOKEN);
  });

  it("a tenant database failure prevents the requested N3 dataset call", async () => {
    failures.tenant = true;
    const up = mockUpstream(() => jsonResponse(basicInfo()));
    const res = await handleN3ProxyRequest(get(PATH), PATH);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message: string; correlationId: string };
    expect(body.message).toBe("Tenant context could not be established");
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(up.calls.every((u) => u.includes("BasicInfo"))).toBe(true);
  });
});

type Provisioning = { status: string; role?: string; userPersisted?: boolean; reason?: string };

async function sessionBody(): Promise<{ raw: string; provisioning: Provisioning }> {
  const res = await handleSessionRequest(get("session", OWNER_TOKEN, `${BASE}session`));
  const raw = await res.text();
  const parsed = JSON.parse(raw) as { data: { provisioning: Provisioning } };
  return { raw, provisioning: parsed.data.provisioning };
}

function auditRows() {
  return dbCalls.filter((c) => c.table === "projecthub_integration_audit_events");
}
function roleUpserts() {
  return dbCalls.filter((c) => c.table === "projecthub_user_roles");
}

describe("session bootstrap provisioning matrix", () => {
  it("full success reports provisioned and audits succeeded", async () => {
    mockUpstream(() => jsonResponse(basicInfo()));
    const { provisioning } = await sessionBody();
    expect(provisioning.status).toBe("provisioned");
    expect(provisioning.role).toBe("owner");
    expect(provisioning.userPersisted).toBe(true);
    expect(roleUpserts()).toHaveLength(1);
    expect((auditRows()[0]!.row as { outcome: string }).outcome).toBe("succeeded");
  });

  it("a failed user-role upsert is reported to the browser as partial", async () => {
    failures.role = true;
    mockUpstream(() => jsonResponse(basicInfo()));
    const { raw, provisioning } = await sessionBody();

    expect(provisioning.status).toBe("partial");
    expect(provisioning.userPersisted).toBe(false);
    expect(raw).not.toContain("provisioned");

    // The tenant row resolved, and the user-role upsert was attempted once.
    const tenant = dbCalls.find((c) => c.table === "projecthub_tenants");
    expect(tenant).toBeDefined();
    expect(roleUpserts()).toHaveLength(1);

    const audit = auditRows()[0]!;
    expect((audit.row as { outcome: string }).outcome).toBe("partial");
    expect((audit.row as { tenant_id: string }).tenant_id).toBe("tenant-row-1");

    // No secret or database error text is leaked anywhere.
    for (const text of [raw, JSON.stringify(audit.row)]) {
      expect(text).not.toContain(OWNER_TOKEN);
      expect(text).not.toContain("super-secret-key");
      expect(text).not.toContain("db down");
    }
  });

  it("a missing N3 user id creates no shadow user and still reports provisioned", async () => {
    mockUpstream(() =>
      jsonResponse(basicInfo({ userId: undefined, currentUserId: undefined, userGuid: undefined })),
    );
    const { provisioning } = await sessionBody();
    expect(provisioning.status).toBe("provisioned");
    expect(provisioning.userPersisted).toBe(false);
    expect(roleUpserts()).toHaveLength(0);
    const audit = auditRows()[0]!.row as { outcome: string; metadata: { userIdContract: string } };
    expect(audit.outcome).toBe("succeeded");
    expect(audit.metadata.userIdContract).toBe("missing");
  });

  it("a tenant upsert failure reports unprovisioned with database_error and audits failed", async () => {
    failures.tenant = true;
    mockUpstream(() => jsonResponse(basicInfo()));
    const { provisioning } = await sessionBody();
    expect(provisioning.status).toBe("unprovisioned");
    expect(provisioning.reason).toBe("database_error");
    expect(roleUpserts()).toHaveLength(0);
    expect((auditRows()[0]!.row as { outcome: string }).outcome).toBe("failed");
  });

  it("missing tenant identity reports unprovisioned with missing_tenant_identity", async () => {
    mockUpstream(() =>
      jsonResponse(
        basicInfo({ tenantId: undefined, id: undefined, dbId: undefined, tenantGuid: undefined }),
      ),
    );
    const { provisioning } = await sessionBody();
    expect(provisioning.status).toBe("unprovisioned");
    expect(provisioning.reason).toBe("missing_tenant_identity");
    expect(dbCalls.filter((c) => c.table === "projecthub_tenants")).toHaveLength(0);
    expect((auditRows()[0]!.row as { outcome: string }).outcome).toBe("failed");
  });
});

describe("development connect gate", () => {
  const cases: (string | undefined)[] = ["production", "test", "staging", "", undefined];

  it("returns 404 for every non-development runtime and never calls N3", async () => {
    const { handleConnectRequest } = await import("@/lib/n3-connect.server");
    const previous = process.env["NODE_ENV"];
    for (const env of cases) {
      const up = mockUpstream(() => jsonResponse({ code: "0000", data: { token: "x" } }));
      if (env === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = env;
      const res = await handleConnectRequest(
        new Request("http://localhost:8080/api/public/auth/connect", {
          method: "POST",
          body: JSON.stringify({ apiKey: "super-secret-key" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status, String(env)).toBe(404);
      expect(up.calls, String(env)).toHaveLength(0);
      vi.unstubAllGlobals();
    }
    process.env["NODE_ENV"] = previous;
  });

  it("is available in development and stores nothing but the exchanged N3 token", async () => {
    const { handleConnectRequest } = await import("@/lib/n3-connect.server");
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    const up = mockUpstream(() =>
      jsonResponse({ code: "0000", data: { token: "n3.jwt.value", expiration: null } }),
    );
    const res = await handleConnectRequest(
      new Request("http://localhost:8080/api/public/auth/connect", {
        method: "POST",
        body: JSON.stringify({ apiKey: "super-secret-key" }),
        headers: { "content-type": "application/json" },
      }),
    );
    process.env["NODE_ENV"] = previous;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe("n3.jwt.value");
    expect(JSON.stringify(body)).not.toContain("super-secret-key");
    expect(up.calls).toHaveLength(1);
  });
});
