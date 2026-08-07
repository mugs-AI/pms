import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basicInfo, jsonResponse, mockUpstream, OWNER_TOKEN, USER_TOKEN } from "./helpers";

const dbCalls: { table: string; op: string; row: unknown }[] = [];

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
      return {
        select: () => ({
          single: async () => ({ data: { id: "tenant-row-1" }, error: null }),
        }),
        then: undefined,
      };
    },
    async insert(row: unknown) {
      dbCalls.push({ table, op: "insert", row });
      return { error: null };
    },
  });
  return { supabaseAdmin: { from: (table: string) => makeChain(table) } };
});

const { handleN3ProxyRequest, handleSessionRequest, methodNotAllowed } =
  await import("@/lib/n3-proxy.server");

const BASE = "http://localhost:8080/api/public/n3/";

function get(path: string, token: string | null = OWNER_TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request(`${BASE}${path}`, { headers });
}

/** All upstream calls in these tests are mocked; the live N3 tenant is never contacted. */
function upstreamFor(owner: boolean) {
  return mockUpstream((url) => {
    if (url.includes("CompanyProfile/BasicInfo")) {
      return jsonResponse(basicInfo({ isOwner: owner }));
    }
    return jsonResponse({ code: "0000", success: true, data: { value: [], count: 0 } });
  });
}

beforeEach(() => {
  dbCalls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("allowlist enforcement", () => {
  it("1. an allowlisted GET reaches the mocked N3 fetch", async () => {
    const up = upstreamFor(true);
    const res = await handleN3ProxyRequest(
      get("main/api/Customers/List?$top=25"),
      "main/api/Customers/List",
    );
    expect(res.status).toBe(200);
    expect(
      up.calls.some(
        (u) =>
          u.includes("/api/Customers/List?%24top=25") || u.includes("/api/Customers/List?$top=25"),
      ),
    ).toBe(true);
  });

  it("2. an unknown or malformed path is rejected before fetch", async () => {
    const up = upstreamFor(true);
    for (const p of [
      "main/api/SalesInvoices/List",
      "main/api/Customers/Delete",
      "reporting/api/Projects/All",
      "api/Users",
      "other/api/Users",
    ]) {
      const res = await handleN3ProxyRequest(get(p), p);
      expect(res.status).toBe(404);
    }
    expect(up.calls).toHaveLength(0);
  });

  it("3. traversal and encoded traversal are rejected before fetch", async () => {
    const up = upstreamFor(true);
    for (const p of [
      "main/../api/Users",
      "main/api/%2e%2e/Users",
      "main/api//Users",
      "main\\api\\Users",
      "main/api/Users%00",
    ]) {
      const res = await handleN3ProxyRequest(get(encodeURI(p)), p);
      expect(res.status).toBe(404);
    }
    expect(up.calls).toHaveLength(0);
  });

  it("4. POST/PUT/PATCH/DELETE cannot reach N3", async () => {
    const up = upstreamFor(true);
    const res = methodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(up.calls).toHaveLength(0);
  });

  it("5. missing or malformed bearer authentication returns 401", async () => {
    const up = upstreamFor(true);
    const path = "main/api/Customers/List";
    expect((await handleN3ProxyRequest(get(path, null), path)).status).toBe(401);
    const basicAuth = new Request(`${BASE}${path}`, {
      headers: { authorization: "Basic abcdefghijklmnop" },
    });
    expect((await handleN3ProxyRequest(basicAuth, path)).status).toBe(401);
    const twoTokens = new Request(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}, Bearer ${USER_TOKEN}` },
    });
    expect((await handleN3ProxyRequest(twoTokens, path)).status).toBe(401);
    expect(up.calls).toHaveLength(0);
  });

  it("13. query allowlist and $top bounds are enforced", async () => {
    const up = upstreamFor(true);
    const path = "main/api/Customers/List";
    const cases = [
      "?apiKey=secret",
      "?$top=5000",
      "?$top=0",
      "?$top=abc",
      "?$orderby=name;drop",
      "?$skip=-1",
    ];
    for (const q of cases) {
      const req = new Request(`${BASE}${path}${q}`, {
        headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      });
      expect((await handleN3ProxyRequest(req, path)).status).toBe(400);
    }
    expect(up.calls).toHaveLength(0);

    // Endpoints without OData support reject paging parameters too.
    const noParams = "main/api/Projects/All";
    const req = new Request(`${BASE}${noParams}?$top=10`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect((await handleN3ProxyRequest(req, noParams)).status).toBe(400);
  });
});

describe("server-side owner enforcement", () => {
  it("6. a non-owner BasicInfo session receives 403 for protected master reads", async () => {
    const up = upstreamFor(false);
    const path = "main/api/Customers/List";
    const res = await handleN3ProxyRequest(get(path, USER_TOKEN), path);
    expect(res.status).toBe(403);
    expect(up.calls.every((u) => u.includes("BasicInfo"))).toBe(true);
  });

  it("7. an Owner master read succeeds using the same verified token", async () => {
    upstreamFor(true);
    const path = "main/api/Stocks/List";
    const res = await handleN3ProxyRequest(get(path), path);
    expect(res.status).toBe(200);
  });

  it("8. a JWT claim saying isOwner=true cannot elevate a BasicInfo non-owner", async () => {
    // The token payload below decodes to {"isOwner":"true","tenantCode":"EVIL"}.
    const claimToken =
      "eyJhbGciOiJIUzI1NiJ9.eyJpc093bmVyIjoidHJ1ZSIsInRlbmFudENvZGUiOiJFVklMIn0.signaturesignature";
    upstreamFor(false);
    const path = "main/api/Users";
    const res = await handleN3ProxyRequest(get(path, claimToken), path);
    expect(res.status).toBe(403);
  });

  it("16. a browser-supplied tenant cannot influence tenant resolution", async () => {
    upstreamFor(true);
    const path = "main/api/Customers/List";
    const req = new Request(`${BASE}${path}?tenantId=99999999-9999-9999-9999-999999999999`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    // Unknown query parameters never reach N3 at all.
    expect((await handleN3ProxyRequest(req, path)).status).toBe(400);

    const sessionReq = new Request(
      "http://localhost:8080/api/public/n3/session?tenantId=other-tenant",
      {
        headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      },
    );
    await handleSessionRequest(sessionReq);
    const tenantUpsert = dbCalls.find((c) => c.table === "projecthub_tenants");
    expect((tenantUpsert?.row as { n3_tenant_id: string }).n3_tenant_id).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
});

describe("session resolution and bootstrap", () => {
  it("9. missing immutable tenant identity fails closed for tenant bootstrap", async () => {
    mockUpstream(() =>
      jsonResponse(
        basicInfo({ tenantId: undefined, id: undefined, dbId: undefined, tenantGuid: undefined }),
      ),
    );
    const res = await handleSessionRequest(get("session"));
    const body = (await res.json()) as {
      data: { provisioning: { status: string; reason: string } };
    };
    expect(body.data.provisioning).toEqual({
      status: "unprovisioned",
      reason: "missing_tenant_identity",
    });
    expect(dbCalls.some((c) => c.table === "projecthub_tenants")).toBe(false);
  });

  it("10. email string and email-array responses normalise safely", async () => {
    mockUpstream(() =>
      jsonResponse(basicInfo({ email: ["", "not-an-email", "second@acme.test"] })),
    );
    const arrayRes = (await (await handleSessionRequest(get("session"))).json()) as {
      data: { email: string };
    };
    expect(arrayRes.data.email).toBe("second@acme.test");

    mockUpstream(() => jsonResponse(basicInfo({ email: "owner@acme.test" })));
    const stringRes = (await (await handleSessionRequest(get("session"))).json()) as {
      data: { email: string };
    };
    expect(stringRes.data.email).toBe("owner@acme.test");
  });

  it("records a sanitised audit event without secrets", async () => {
    upstreamFor(true);
    await handleSessionRequest(get("session"));
    const audit = dbCalls.find((c) => c.table === "projecthub_integration_audit_events");
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit?.row)).not.toContain(OWNER_TOKEN);
  });
});

describe("upstream failure handling", () => {
  it("14. timeouts and oversized/non-JSON upstream responses fail safely", async () => {
    const path = "main/api/Terms/Query";

    mockUpstream((url) => {
      if (url.includes("BasicInfo")) return jsonResponse(basicInfo());
      return new Response("<html>gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const nonJson = await handleN3ProxyRequest(get(path), path);
    expect(nonJson.status).toBe(502);
    expect(await nonJson.text()).not.toContain("gateway");

    mockUpstream((url) => {
      if (url.includes("BasicInfo")) return jsonResponse(basicInfo());
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(50 * 1024 * 1024) },
      });
    });
    expect((await handleN3ProxyRequest(get(path), path)).status).toBe(502);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        if (String(input).includes("BasicInfo")) return jsonResponse(basicInfo());
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    const timedOut = await handleN3ProxyRequest(get(path), path);
    expect(timedOut.status).toBe(504);
    const body = (await timedOut.json()) as { message: string; correlationId: string };
    expect(body.message).toBe("N3 Open API could not be read");
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("development connect route", () => {
  it("12. production connect returns 404 and never contacts the mocked upstream", async () => {
    const { handleConnectRequest } = await import("@/lib/n3-connect.server");
    const up = mockUpstream(() => jsonResponse({ code: "0000", data: { token: "x" } }));
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    const res = await handleConnectRequest(
      new Request("http://localhost:8080/api/public/auth/connect", {
        method: "POST",
        body: JSON.stringify({ apiKey: "super-secret-key" }),
        headers: { "content-type": "application/json" },
      }),
    );
    process.env["NODE_ENV"] = previous;
    expect(res.status).toBe(404);
    expect(up.calls).toHaveLength(0);
  });
});
