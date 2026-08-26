/**
 * P1-N3-CUST-01 — N3 Customer Read/Search Completeness (server behavior).
 *
 * Proves the single customer search contract shared by the business picker
 * and the verification customers tab:
 *  - owner-only master-data reads through GET /api/projecthub/n3/customers
 *  - normalized case-insensitive contains search across BOTH Customers/List
 *    fields (`code`, `companyName`) via server-built $filter OR semantics
 *  - explicit $top/$skip paging with the one-row completeness probe
 *  - truthful totals: only shown when N3 reported a consistent count; explicit
 *    completeness metadata (hasMore / null total) — never a fabricated count
 *  - unauthorized-role denial, upstream-failure mapping, client-supplied
 *    tenant context rejection, and tenant-scoped diagnostics
 *
 * Every N3 call is mocked; the suite never reaches a live N3 host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basicInfo, jsonResponse, mockUpstream, OWNER_TOKEN, USER_TOKEN } from "./helpers";

type Call = { table: string; op: string; row: unknown };
const dbCalls: Call[] = [];

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
      const result = { data: { id: "tenant-row-1" }, error: null };
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

const { handleProjectHubRequest } = await import("@/lib/projecthub-api.server");

const BASE = "http://localhost:8080/api/projecthub";
const SPLAT = "n3/customers";

function get(query = "", token: string | null = OWNER_TOKEN, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request(`${BASE}/n3/customers${query}`, { headers });
}

const ROWS = [
  { id: "cust-1", code: "C001", companyName: "Acme Builders", phone1: "010 555 0101" },
  { id: "cust-2", code: "C002", companyName: "Bayside Holdings", phone1: "010 555 0102" },
];

function n3Page(value: unknown[], count?: number) {
  return jsonResponse({
    code: "0000",
    success: true,
    data: count === undefined ? { value } : { value, count },
  });
}

/**
 * Owner session upstream: BasicInfo resolves the owner identity, then the
 * Customers/List read returns `customerResponder`.
 */
function upstreamFor(customerResponder: (url: string) => Response) {
  return mockUpstream((url) =>
    url.includes("BasicInfo") ? jsonResponse(basicInfo({ isOwner: true })) : customerResponder(url),
  );
}

function customerCalls(calls: string[]) {
  return calls.filter((u) => u.includes("Customers/List"));
}

function lastDiagnostic() {
  const rows = dbCalls.filter((c) => c.table === "projecthub_n3_request_diagnostics");
  return rows[rows.length - 1]?.row as Record<string, unknown> | undefined;
}

beforeEach(() => {
  dbCalls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("P1-N3-CUST-01 server behavior", () => {
  it("returns 401 when the bearer token is missing", async () => {
    const res = await handleProjectHubRequest(get("", null), SPLAT);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the session is not an N3 owner", async () => {
    const up = mockUpstream(() => jsonResponse(basicInfo({ isOwner: false })));
    const res = await handleProjectHubRequest(get("", USER_TOKEN), SPLAT);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(String(body.message)).toMatch(/role does not allow/i);
    expect(customerCalls(up.calls)).toHaveLength(0);
  });

  it("rejects client-supplied tenant context headers (400)", async () => {
    const res = await handleProjectHubRequest(
      get("", OWNER_TOKEN, { "x-n3-tenant-id": "attacker-tenant" }),
      SPLAT,
    );
    expect(res.status).toBe(400);
  });

  it("builds one normalized OR filter across code and companyName with a probe row", async () => {
    const up = upstreamFor(() => n3Page(ROWS, 2));
    const res = await handleProjectHubRequest(get("?search=Acme&pageSize=50"), SPLAT);
    expect(res.status).toBe(200);
    const calls = customerCalls(up.calls);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(url.searchParams.get("$filter")).toBe(
      "contains(tolower(code),'acme') or contains(tolower(companyName),'acme')",
    );
    // $top carries the one-row completeness probe.
    expect(url.searchParams.get("$top")).toBe("51");
    expect(url.searchParams.get("$skip")).toBe("0");
  });

  it("lowercases the term and strips OData-hostile characters (no injection)", async () => {
    const up = upstreamFor(() => n3Page(ROWS, 2));
    const res = await handleProjectHubRequest(
      get(`?search=${encodeURIComponent("O'Brien') or true or ('")}`),
      SPLAT,
    );
    expect(res.status).toBe(200);
    const filter = new URL(customerCalls(up.calls)[0]!).searchParams.get("$filter")!;
    // Quote characters are stripped, so the injected payload can never break
    // out of the string literal: exactly two contains() clauses are emitted.
    // Only the four literal delimiters remain — no injected quote survives.
    expect((filter.match(/'/g) ?? []).length).toBe(4);
    expect((filter.match(/contains\(tolower\(/g) ?? []).length).toBe(2);
    expect(filter).toContain("obrien");
    expect(filter.startsWith("contains(tolower(code),'")).toBe(true);
  });

  it("honours explicit paging with skip = page * pageSize", async () => {
    const up = upstreamFor(() => n3Page(ROWS, 200));
    const res = await handleProjectHubRequest(get("?page=2&pageSize=25"), SPLAT);
    expect(res.status).toBe(200);
    const url = new URL(customerCalls(up.calls)[0]!);
    expect(url.searchParams.get("$top")).toBe("26");
    expect(url.searchParams.get("$skip")).toBe("50");
  });

  it("reports the upstream total when N3 returns a consistent count", async () => {
    upstreamFor(() => n3Page(ROWS, 2));
    const res = await handleProjectHubRequest(get("?pageSize=50"), SPLAT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(2);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.options).toHaveLength(2);
    expect(body.data.options[0]).toMatchObject({ code: "C001", name: "Acme Builders" });
  });

  it("exposes hasMore via the probe row and never includes the probe row in the page", async () => {
    upstreamFor(() => n3Page([...ROWS, { id: "cust-3", code: "C003", companyName: "Cobalt Ltd" }]));
    const res = await handleProjectHubRequest(get("?search=C&pageSize=2"), SPLAT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.hasMore).toBe(true);
    expect(body.data.total).toBeNull();
    expect(body.data.options).toHaveLength(2);
    expect(body.data.options.map((o: { code: string }) => o.code)).toEqual(["C001", "C002"]);
  });

  it("returns a null total when N3 omits the count, flagging possible incompleteness", async () => {
    upstreamFor(() => n3Page(ROWS));
    const res = await handleProjectHubRequest(get(""), SPLAT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBeNull();
  });

  it("discards an upstream count that contradicts the received page", async () => {
    upstreamFor(() => n3Page(ROWS, 1));
    const res = await handleProjectHubRequest(get(""), SPLAT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBeNull();
  });

  it("maps upstream N3 failures to 502 without fabricating results", async () => {
    upstreamFor(() => jsonResponse({ message: "down" }, 503));
    const res = await handleProjectHubRequest(get(""), SPLAT);
    expect(res.status).toBe(502);
  });

  it("maps contract-mismatch payloads to 502", async () => {
    upstreamFor(() => jsonResponse({ code: "9999", success: false }));
    const res = await handleProjectHubRequest(get(""), SPLAT);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(String(body.message)).toMatch(/contract/i);
  });

  it("scopes every diagnostic row to the resolved internal tenant row id", async () => {
    upstreamFor(() => n3Page(ROWS, 2));
    const res = await handleProjectHubRequest(get(""), SPLAT);
    expect(res.status).toBe(200);
    const diag = lastDiagnostic();
    expect(diag).toBeDefined();
    expect(diag!.tenant_id).toBe("tenant-row-1");
    expect(diag!.operation_id).toBe("picker.customers");
    expect(diag!.outcome).toBe("succeeded");
  });
});
