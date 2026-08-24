/**
 * P1-N3-CUST-01 — N3 Customer Read/Search Completeness (server behavior).
 *
 * Proves the single customer search contract shared by the business picker
 * and the verification customers tab:
 *  - owner-only master-data reads through GET /api/projecthub/n3/customers
 *  - normalized case-insensitive contains search across BOTH Customers/List
 *    fields (`code`, `companyName`) via server-built $filter OR semantics
 *  - explicit $top/$skip paging with the one-row completeness probe
 *  - truthful totals: only shown when N3 reported a count; explicit
 *    completeness metadata (hasMore / null total) — never a fabricated count
 *  - browser identity binding, unauthorized-role denial, upstream-failure
 *    mapping, and tenant-scoped diagnostics
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleProjectHubApiRequest } from "../src/lib/projecthub-api.server";
import { getSupabaseAdmin } from "../src/lib/projecthub-db.server";

const { n3Get } = vi.hoisted(() => ({ n3Get: vi.fn() }));
vi.mock("../src/lib/n3-api.server", () => ({ n3Get }));

const DEV_KEY = "dev-test-key";
const SECRET = "test-session-secret";

interface SessionOverrides {
  isOwner?: boolean;
  roles?: string[];
  tenantCode?: string | null;
  email?: string | null;
  userName?: string;
  userId?: string;
}

function makeCookie(overrides: SessionOverrides = {}) {
  const claims = {
    tenantCode: "TENANT-1",
    companyCode: "TENANT-1",
    email: "owner@example.com",
    name: "Owner User",
    userId: "user-1",
    role: "sys-admin",
    roles: ["sys-admin", "dev"],
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `n3_dev_session=${payload}.${sig}`;
}

function customersRequest(query: string, overrides: SessionOverrides = {}) {
  return new Request(`http://localhost/api/projecthub/n3/customers${query}`, {
    headers: {
      "x-n3-api-key": DEV_KEY,
      cookie: makeCookie(overrides),
      "user-agent": "Vitest",
    },
  });
}

function n3Page(value: unknown[], count?: number) {
  return {
    ok: true,
    status: 200,
    bytes: 512,
    body: {
      code: "0000",
      message: "Success",
      success: true,
      ...(count === undefined
        ? { data: { value } }
        : { data: { value, count } }),
    },
  };
}

const ROWS = [
  { Code: "C001", CompanyName: "Acme Builders", Tel: "010 555 0101" },
  { Code: "C002", CompanyName: "Bayside Holdings", Tel: "010 555 0102" },
];

async function lastDiagnostic() {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("projecthub_n3_request_diagnostics")
    .select("tenant_row_id, actor, operation_id, status_code, outcome, response_bytes")
    .order("ended_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data[0];
}

describe("P1-N3-CUST-01 server behavior", () => {
  beforeEach(() => {
    process.env.N3_API_KEY = DEV_KEY;
    process.env.N3_SESSION_SECRET = SECRET;
    n3Get.mockReset();
    n3Get.mockResolvedValue(n3Page(ROWS, 2));
  });

  it("returns 401 when the session is missing or the bearer token is wrong", async () => {
    const noSession = await handleProjectHubApiRequest(
      new Request("http://localhost/api/projecthub/n3/customers", {
        headers: { "x-n3-api-key": DEV_KEY },
      }),
      "/n3/customers",
    );
    expect(noSession.status).toBe(401);

    const badKey = await handleProjectHubApiRequest(
      new Request("http://localhost/api/projecthub/n3/customers", {
        headers: { "x-n3-api-key": "wrong", cookie: makeCookie() },
      }),
      "/n3/customers",
    );
    expect(badKey.status).toBe(401);
    expect(n3Get).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not an N3 owner (sys-admin only)", async () => {
    const nonOwner = await handleProjectHubApiRequest(
      customersRequest("?pageSize=10", { roles: ["projecthub:project:read"] }),
      "/n3/customers",
    );
    expect(nonOwner.status).toBe(403);
    const body = await nonOwner.json();
    expect(body.error).toContain("Owner");
    expect(n3Get).not.toHaveBeenCalled();
  });

  it("builds one normalized OR filter across code and companyName", async () => {
    const res = await handleProjectHubApiRequest(
      customersRequest("?search=Acme&pageSize=50"),
      "/n3/customers",
    );
    expect(res.status).toBe(200);
    expect(n3Get).toHaveBeenCalledTimes(1);
    const [path, options] = n3Get.mock.calls[0];
    expect(path).toBe("Customers/List");
    const filter = options.params.get("$filter");
    expect(filter).toBe(
      "contains(tolower(code),'acme') or contains(tolower(companyname),'acme')",
    );
    // $top carries the one-row completeness probe.
    expect(options.params.get("$top")).toBe("51");
    expect(options.params.get("$skip")).toBe("0");
  });

  it("lowercases and escapes apostrophes in the search term", async () => {
    await handleProjectHubApiRequest(
      customersRequest(`?search=${encodeURIComponent("O'Brien")}`),
      "/n3/customers",
    );
    const [, options] = n3Get.mock.calls[0];
    expect(options.params.get("$filter")).toContain("o''brien");
  });

  it("honours explicit paging with skip = page * pageSize", async () => {
    await handleProjectHubApiRequest(customersRequest("?page=2&pageSize=25"), "/n3/customers");
    const [, options] = n3Get.mock.calls[0];
    expect(options.params.get("$top")).toBe("26");
    expect(options.params.get("$skip")).toBe("50");
  });

  it("reports the upstream total when N3 returns a consistent count", async () => {
    const res = await handleProjectHubApiRequest(customersRequest("?pageSize=50"), "/n3/customers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(2);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.options).toHaveLength(2);
    expect(body.data.options[0]).toMatchObject({ code: "C001", name: "Acme Builders" });
  });

  it("exposes hasMore via the probe row and never includes the probe row in the page", async () => {
    n3Get.mockResolvedValueOnce(n3Page([...ROWS, { Code: "C003", CompanyName: "Cobalt Ltd" }]));
    const res = await handleProjectHubApiRequest(
      customersRequest("?search=C&pageSize=2"),
      "/n3/customers",
    );
    const body = await res.json();
    expect(body.data.hasMore).toBe(true);
    expect(body.data.total).toBeNull();
    expect(body.data.options).toHaveLength(2);
    expect(body.data.options.map((o: { code: string }) => o.code)).toEqual(["C001", "C002"]);
  });

  it("returns a null total when N3 omits the count, flagging possible incompleteness", async () => {
    n3Get.mockResolvedValueOnce(n3Page(ROWS));
    const res = await handleProjectHubApiRequest(customersRequest(""), "/n3/customers");
    const body = await res.json();
    expect(body.data.total).toBeNull();
  });

  it("discards an upstream count that contradicts the received page", async () => {
    n3Get.mockResolvedValueOnce(n3Page(ROWS, 1));
    const res = await handleProjectHubApiRequest(customersRequest(""), "/n3/customers");
    const body = await res.json();
    expect(body.data.total).toBeNull();
  });

  it("maps upstream N3 failures to 502 with a diagnostic", async () => {
    n3Get.mockResolvedValueOnce({
      ok: false,
      status: 503,
      bytes: 0,
      body: { message: "down" },
    });
    const res = await handleProjectHubApiRequest(customersRequest(""), "/n3/customers");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("503");
    expect(n3Get).toHaveBeenCalledTimes(1);
  });

  it("maps contract-mismatch payloads to 502", async () => {
    n3Get.mockResolvedValueOnce({ ok: true, status: 200, bytes: 10, body: { code: "9999" } });
    const res = await handleProjectHubApiRequest(customersRequest(""), "/n3/customers");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("contract");
  });

  it("binds the N3 selection to the session tenant (spoofed headers are ignored)", async () => {
    const res = await handleProjectHubApiRequest(
      new Request("http://localhost/api/projecthub/n3/customers", {
        headers: {
          "x-n3-api-key": DEV_KEY,
          cookie: makeCookie(),
          "x-n3-company-code": "ATTACKER-TENANT",
        },
      }),
      "/n3/customers",
    );
    expect(res.status).toBe(200);
    const [, options] = n3Get.mock.calls[0];
    expect(options.headers["CompanyCode"]).toBe("TENANT-1");
    expect(options.headers["Email"]).toBe("owner@example.com");
    expect(options.headers["Name"]).toBe("Owner User");
  });

  it("fails closed (401) when the session carries no tenant binding", async () => {
    const res = await handleProjectHubApiRequest(
      customersRequest("", { tenantCode: null, userId: null }),
      "/n3/customers",
    );
    expect(res.status).toBe(401);
    expect(n3Get).not.toHaveBeenCalled();
  });

  it("fails closed (401) when the session carries no user binding", async () => {
    const res = await handleProjectHubApiRequest(
      customersRequest("", { email: null, userName: "", userId: null }),
      "/n3/customers",
    );
    expect(res.status).toBe(401);
    expect(n3Get).not.toHaveBeenCalled();
  });

  it("scopes every diagnostic row to the resolved tenant_row_id", async () => {
    await handleProjectHubApiRequest(customersRequest(""), "/n3/customers");
    const diag = await lastDiagnostic();
    expect(diag).toBeDefined();
    expect(String(diag.tenant_row_id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(diag.operation_id).toBe("picker.customers");
    expect(diag.outcome).toBe("succeeded");
  });
});
