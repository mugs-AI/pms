/**
 * WP0B-1 — ten-dataset N3 master registry regression matrix.
 *
 * This suite exercises the REAL modules (`n3-master-registry`,
 * `projecthub-n3.server`, `projecthub-api.server`) for every one of the ten
 * canonical N3 master datasets. It never performs a source-text scan in place
 * of behaviour, and every N3 call is mocked — no live N3 host is reached.
 *
 * Covered:
 *  D1 exact registry coverage (kind, operation id, path, mode, field variants)
 *  D2 dataset-specific row mapping, DTO minimality and search matching
 *  D3 shared bounded scan behaviour, completeness truthfulness, diagnostics
 *  D4 route and permission matrix for master routes and business pickers
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MASTER_KINDS,
  MASTER_SPECS,
  isMasterKind,
  normalizeForSearch,
  optionMatches,
  type MasterKind,
} from "@/lib/n3-master-registry";
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
const { mapMasterRow, SCAN_PAGE_SIZE, isPickerKind, pickerPermission } = await import(
  "@/lib/projecthub-n3.server"
);

const BASE = "http://localhost:8080/api/projecthub";

const TEN: MasterKind[] = [
  "projects",
  "customers",
  "suppliers",
  "stocks",
  "uoms",
  "locations",
  "users",
  "accounts",
  "tax-codes",
  "terms",
];

const EXPECTED: Record<MasterKind, { operationId: string; path: string; mode: "all" | "page" }> = {
  projects: { operationId: "projects.all", path: "api/Projects/All", mode: "all" },
  customers: { operationId: "customers.list", path: "api/Customers/List", mode: "page" },
  suppliers: { operationId: "suppliers.list", path: "api/Suppliers/List", mode: "page" },
  stocks: { operationId: "stocks.list", path: "api/Stocks/List", mode: "page" },
  uoms: { operationId: "uoms.query", path: "api/UOMs/Query", mode: "page" },
  locations: {
    operationId: "stocklocations.query",
    path: "api/StockLocations/Query",
    mode: "page",
  },
  users: { operationId: "users.list", path: "api/Users", mode: "all" },
  accounts: {
    operationId: "accountcodes.leaf.query",
    path: "api/AccountCodes/Leaf/Query",
    mode: "page",
  },
  "tax-codes": { operationId: "taxcodes.query", path: "api/TaxCodes/Query", mode: "page" },
  terms: { operationId: "terms.query", path: "api/Terms/Query", mode: "page" },
};

/** One representative, safe N3 row per dataset (no invented field spellings). */
const SAMPLE: Record<MasterKind, Record<string, unknown>> = {
  projects: {
    id: "prj-1",
    code: "PRJ-001",
    projectName: "Lebuhraya Utara Selatan",
    contractSum: 125000,
    internalSecret: "must-not-leak",
  },
  customers: {
    id: "cus-1",
    code: "C001",
    companyName: "Motive Engineering Sdn Bhd",
    email: "ops@motive.test",
  },
  suppliers: { Id: "sup-1", supplierCode: "S001", companyName: "Bina Bekal Sdn Bhd", phone1: "011" },
  stocks: { stockId: "stk-1", stockCode: "ST-9", description: "Cement Bag 50kg", uom: "BAG" },
  uoms: { id: "uom-1", uomCode: "BAG", description: "Bag", rate: 1 },
  locations: { id: "loc-1", locationCode: "HQ", name: "Ibu Pejabat Kuala Lumpur" },
  users: {
    userId: "usr-1",
    userName: "siti.aminah",
    displayName: "Siti Aminah binti Osman",
    email: "siti@acme.test",
  },
  accounts: { id: "acc-1", accountCode: "5000-000", name: "Direct Costs", drcr: "DR" },
  "tax-codes": { id: "tax-1", taxCode: "SST6", description: "Service Tax 6%", rate: 6 },
  terms: { id: "trm-1", termCode: "N30", description: "Net 30 days", value: 30 },
};

function n3Page(value: unknown[], count?: number) {
  return jsonResponse({
    code: "0000",
    success: true,
    data: count === undefined ? { value } : { value, count },
  });
}

function n3All(value: unknown[]) {
  return jsonResponse({ code: "0000", success: true, data: value });
}

function payloadFor(kind: MasterKind, rows: unknown[], count?: number) {
  return MASTER_SPECS[kind].mode === "all" ? n3All(rows) : n3Page(rows, count);
}

/** Owner session upstream: BasicInfo, then the dataset responder. */
function upstreamFor(kind: MasterKind, responder: (url: string) => Response, owner = true) {
  return mockUpstream((url) =>
    url.includes("BasicInfo") ? jsonResponse(basicInfo({ isOwner: owner })) : responder(url),
  );
}

function datasetCalls(kind: MasterKind, calls: string[]) {
  return calls.filter((u) => u.includes(EXPECTED[kind].path.replace("api/", "")));
}

function get(splat: string, query = "", token: string | null = OWNER_TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request(`${BASE}/${splat}${query}`, { headers });
}

beforeEach(() => {
  dbCalls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

/* ------------------------------------------------------------------ */
/* D1 — exact registry coverage                                        */
/* ------------------------------------------------------------------ */

describe("D1 canonical registry", () => {
  it("exposes exactly the ten approved master kinds, once each", () => {
    expect([...MASTER_KINDS].sort()).toEqual([...TEN].sort());
    expect(new Set(MASTER_KINDS).size).toBe(10);
    for (const kind of TEN) expect(isMasterKind(kind)).toBe(true);
    expect(isMasterKind("invoices")).toBe(false);
  });

  it.each(TEN)("%s declares one allowlisted GET operation and complete field variants", (kind) => {
    const spec = MASTER_SPECS[kind];
    expect(spec.kind).toBe(kind);
    expect(spec.operationId).toBe(EXPECTED[kind].operationId);
    expect(spec.path).toBe(EXPECTED[kind].path);
    expect(spec.mode).toBe(EXPECTED[kind].mode);
    expect(spec.idFields.length).toBeGreaterThan(0);
    expect(spec.codeFields.length).toBeGreaterThan(0);
    expect(spec.nameFields.length).toBeGreaterThan(0);
    // No dataset has live-proven upstream filtering in this run.
    expect(spec.filterStrategy).toBe("unproven");
  });

  it("keeps operation ids and paths unique across datasets", () => {
    const ids = TEN.map((k) => MASTER_SPECS[k].operationId);
    const paths = TEN.map((k) => MASTER_SPECS[k].path);
    expect(new Set(ids).size).toBe(10);
    expect(new Set(paths).size).toBe(10);
  });

  it("mounts exactly the six approved business pickers and no more", () => {
    const mounted = TEN.filter((k) => MASTER_SPECS[k].businessPermission !== null);
    expect([...mounted].sort()).toEqual(
      ["customers", "projects", "stocks", "tax-codes", "uoms", "users"].sort(),
    );
    for (const kind of mounted) expect(isPickerKind(kind)).toBe(true);
    for (const kind of ["suppliers", "locations", "accounts", "terms"]) {
      expect(isPickerKind(kind)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* D2 — mapping, DTO minimality and matching                           */
/* ------------------------------------------------------------------ */

describe("D2 row mapping and search matching", () => {
  it.each(TEN)("%s maps to the minimal id/code/name/detail/rate DTO only", (kind) => {
    const option = mapMasterRow(MASTER_SPECS[kind], SAMPLE[kind]);
    expect(option).not.toBeNull();
    expect(Object.keys(option!).sort()).toEqual(["code", "detail", "id", "name", "rate"]);
    expect(option!.id).toBeTruthy();
    expect(JSON.stringify(option)).not.toContain("must-not-leak");
  });

  it.each(TEN)("%s rejects a row without an immutable N3 id", (kind) => {
    const { ...row } = SAMPLE[kind];
    for (const field of MASTER_SPECS[kind].idFields) delete row[field];
    expect(mapMasterRow(MASTER_SPECS[kind], row)).toBeNull();
  });

  it("maps the dataset-specific display dimensions", () => {
    const project = mapMasterRow(MASTER_SPECS["projects"], SAMPLE["projects"])!;
    expect(project).toMatchObject({ code: "PRJ-001", name: "Lebuhraya Utara Selatan" });

    const customer = mapMasterRow(MASTER_SPECS["customers"], SAMPLE["customers"])!;
    expect(customer.name).toBe("Motive Engineering Sdn Bhd");

    // Supplier via the `Id` / `supplierCode` variants.
    const supplier = mapMasterRow(MASTER_SPECS["suppliers"], SAMPLE["suppliers"])!;
    expect(supplier).toMatchObject({ id: "sup-1", code: "S001", name: "Bina Bekal Sdn Bhd" });

    // Stock via `stockId` / `stockCode` / `description`.
    const stock = mapMasterRow(MASTER_SPECS["stocks"], SAMPLE["stocks"])!;
    expect(stock).toMatchObject({ id: "stk-1", code: "ST-9", name: "Cement Bag 50kg" });
    expect(stock.detail).toBe("BAG");

    const uom = mapMasterRow(MASTER_SPECS["uoms"], SAMPLE["uoms"])!;
    expect(uom).toMatchObject({ code: "BAG", name: "Bag" });

    const location = mapMasterRow(MASTER_SPECS["locations"], SAMPLE["locations"])!;
    expect(location).toMatchObject({ code: "HQ", name: "Ibu Pejabat Kuala Lumpur" });

    const user = mapMasterRow(MASTER_SPECS["users"], SAMPLE["users"])!;
    expect(user).toMatchObject({
      id: "usr-1",
      code: "siti.aminah",
      name: "Siti Aminah binti Osman",
      detail: "siti@acme.test",
    });

    const account = mapMasterRow(MASTER_SPECS["accounts"], SAMPLE["accounts"])!;
    expect(account).toMatchObject({ code: "5000-000", name: "Direct Costs" });

    // Tax code exposes the rate separately and surfaces it as the detail.
    const tax = mapMasterRow(MASTER_SPECS["tax-codes"], SAMPLE["tax-codes"])!;
    expect(tax).toMatchObject({ code: "SST6", name: "Service Tax 6%", rate: "6", detail: "6%" });

    const term = mapMasterRow(MASTER_SPECS["terms"], SAMPLE["terms"])!;
    expect(term).toMatchObject({ code: "N30", name: "Net 30 days", detail: "30" });
  });

  it("normalizes case and repeated/edge whitespace without stripping Unicode", () => {
    expect(normalizeForSearch("  Ibu   PEJABAT  ")).toBe("ibu pejabat");
    expect(normalizeForSearch("Siti Aminah binti Osman")).toContain("aminah");
    expect(normalizeForSearch(" 建筑 材料 ")).toBe("建筑 材料");
  });

  it("matches case-insensitively across the safe display dimensions", () => {
    const user = mapMasterRow(MASTER_SPECS["users"], SAMPLE["users"])!;
    expect(optionMatches(user, "AMINAH")).toBe(true);
    expect(optionMatches(user, "  siti.aminah ")).toBe(true);
    expect(optionMatches(user, "siti@acme")).toBe(true);
    expect(optionMatches(user, "nobody")).toBe(false);
    // An empty term matches everything (browse mode).
    expect(optionMatches(user, "   ")).toBe(true);
  });

  it("keeps Malaysian and Chinese text searchable", () => {
    const location = mapMasterRow(MASTER_SPECS["locations"], {
      id: "loc-9",
      locationCode: "JB",
      name: "Gudang Johor Bahru 仓库",
    })!;
    expect(optionMatches(location, "johor")).toBe(true);
    expect(optionMatches(location, "仓库")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* D3 — shared bounded server search behaviour                         */
/* ------------------------------------------------------------------ */

describe("D3 shared bounded scan for all ten datasets", () => {
  it.each(TEN)("%s searches through allowlisted GET without any $filter", async (kind) => {
    const up = upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1));
    const res = await handleProjectHubRequest(
      get(`master/${kind}`, "?search=a&pageSize=25"),
      `master/${kind}`,
    );
    expect(res.status).toBe(200);
    const calls = datasetCalls(kind, up.calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const url = new URL(call);
      expect(url.searchParams.get("$filter")).toBeNull();
      const top = url.searchParams.get("$top");
      if (MASTER_SPECS[kind].mode === "all") {
        expect(top).toBeNull();
      } else {
        expect(Number(top)).toBeLessThanOrEqual(SCAN_PAGE_SIZE + 1);
        expect(Number(url.searchParams.get("$skip"))).toBeGreaterThanOrEqual(0);
      }
    }
    expect(up.fn.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.body == null));
  });

  it.each(TEN)("%s writes tenant-scoped master.<kind> diagnostics", async (kind) => {
    upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1));
    await handleProjectHubRequest(get(`master/${kind}`), `master/${kind}`);
    const diag = dbCalls
      .filter((c) => c.table === "projecthub_n3_request_diagnostics")
      .pop()!.row as Record<string, unknown>;
    expect(diag["tenant_id"]).toBe("tenant-row-1");
    expect(diag["operation_id"]).toBe(`master.${kind}`);
  });

  it("searches the complete returned list locally for `all` datasets", async () => {
    const rows = [
      { id: "p1", code: "A-1", projectName: "Alpha" },
      { id: "p2", code: "B-2", projectName: "Bravo Motive" },
    ];
    const up = upstreamFor("projects", () => n3All(rows));
    const res = await handleProjectHubRequest(
      get("master/projects", "?search=motive"),
      "master/projects",
    );
    const body = await res.json();
    expect(body.data.options.map((o: { id: string }) => o.id)).toEqual(["p2"]);
    expect(body.data.completeness).toBe("complete");
    expect(body.data.total).toBe(1);
    expect(datasetCalls("projects", up.calls)).toHaveLength(1);
  });

  const PAGED = TEN.filter((k) => MASTER_SPECS[k].mode === "page");

  it.each(PAGED)("%s finds a match beyond the first upstream page", async (kind) => {
    const spec = MASTER_SPECS[kind];
    const idField = spec.idFields[0]!;
    const nameField = spec.nameFields[0]!;
    const first = Array.from({ length: SCAN_PAGE_SIZE + 1 }, (_, i) => ({
      [idField]: `row-${i}`,
      [nameField]: `Filler ${i}`,
    }));
    const second = [{ [idField]: "needle-1", [nameField]: "Motive Target" }];
    const up = upstreamFor(kind, (url) =>
      n3Page(new URL(url).searchParams.get("$skip") === "0" ? first : second),
    );
    const res = await handleProjectHubRequest(
      get(`master/${kind}`, "?search=motive"),
      `master/${kind}`,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.completeness).toBe("complete");
    expect(body.data.options.map((o: { id: string }) => o.id)).toEqual(["needle-1"]);
    expect(datasetCalls(kind, up.calls).length).toBeGreaterThan(1);
  });

  it("does not duplicate overlapping probe rows across pages", async () => {
    const rows = Array.from({ length: SCAN_PAGE_SIZE + 1 }, (_, i) => ({
      id: `c-${i}`,
      code: `C${i}`,
      companyName: `Motive ${i}`,
    }));
    // Second page repeats the probe row, then ends short.
    upstreamFor("customers", (url) =>
      n3Page(new URL(url).searchParams.get("$skip") === "0" ? rows : [rows[SCAN_PAGE_SIZE]]),
    );
    const res = await handleProjectHubRequest(
      get("master/customers", "?search=motive"),
      "master/customers",
    );
    const body = await res.json();
    const ids = body.data.options.map((o: { id: string }) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(body.data.completeness).toBe("complete");
  });

  it("treats an empty final page as complete", async () => {
    upstreamFor("customers", () => n3Page([]));
    const res = await handleProjectHubRequest(
      get("master/customers", "?search=motive"),
      "master/customers",
    );
    const body = await res.json();
    expect(body.data.completeness).toBe("complete");
    expect(body.data.options).toHaveLength(0);
    expect(body.data.total).toBe(0);
  });

  it("reports incomplete — never a truthful-looking complete zero — when the scan stalls", async () => {
    // Every page returns the same rows: the scan cannot progress.
    const rows = Array.from({ length: SCAN_PAGE_SIZE + 1 }, (_, i) => ({
      id: `dup-${i}`,
      code: `D${i}`,
      companyName: `Duplicate ${i}`,
    }));
    upstreamFor("customers", () => n3Page(rows));
    const res = await handleProjectHubRequest(
      get("master/customers", "?search=motive"),
      "master/customers",
    );
    const body = await res.json();
    expect(body.data.options).toHaveLength(0);
    expect(body.data.completeness).toBe("incomplete");
    expect(body.data.reason).toBe("non_progress");
    // A null total plus hasMore prevents a false "0 records" claim.
    expect(body.data.total).toBeNull();
    expect(body.data.hasMore).toBe(true);
  });

  it("returns a total only when the count is proven by a completed scan", async () => {
    upstreamFor("terms", () => n3Page([SAMPLE["terms"]], 1));
    const res = await handleProjectHubRequest(get("master/terms", "?search=net"), "master/terms");
    const body = await res.json();
    expect(body.data.completeness).toBe("complete");
    expect(body.data.total).toBe(1);
  });

  it("never introduces an N3 write method or path", async () => {
    const up = upstreamFor("customers", () => n3Page([SAMPLE["customers"]], 1));
    await handleProjectHubRequest(get("master/customers"), "master/customers");
    for (const [, init] of up.fn.mock.calls) {
      const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      expect(method).toBe("GET");
    }
  });
});

/* ------------------------------------------------------------------ */
/* D4 — route and permission matrix                                    */
/* ------------------------------------------------------------------ */

describe("D4 master route and picker permission matrix", () => {
  it.each(TEN)("owner may GET /api/projecthub/master/%s", async (kind) => {
    upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1));
    const res = await handleProjectHubRequest(get(`master/${kind}`), `master/${kind}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data.options[0]).sort()).toEqual([
      "code",
      "detail",
      "id",
      "name",
      "rate",
    ]);
  });

  it.each(TEN)("non-owner is denied /api/projecthub/master/%s", async (kind) => {
    const up = upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1), false);
    const res = await handleProjectHubRequest(
      get(`master/${kind}`, "", USER_TOKEN),
      `master/${kind}`,
    );
    expect(res.status).toBe(403);
    expect(datasetCalls(kind, up.calls)).toHaveLength(0);
  });

  it("returns 404 for an unknown master kind", async () => {
    upstreamFor("customers", () => n3Page([]));
    const res = await handleProjectHubRequest(get("master/invoices"), "master/invoices");
    expect(res.status).toBe(404);
  });

  it.each(["POST", "PATCH", "DELETE"])("denies %s on a master route", async (method) => {
    upstreamFor("customers", () => n3Page([]));
    const request = new Request(`${BASE}/master/customers`, {
      method,
      headers: { authorization: `Bearer ${OWNER_TOKEN}`, "content-type": "application/json" },
      body: method === "DELETE" ? null : "{}",
    });
    const res = await handleProjectHubRequest(request, "master/customers");
    expect(res.status).toBe(405);
  });

  const PICKERS = ["customers", "projects", "stocks", "uoms", "tax-codes", "users"] as const;

  it.each(PICKERS)("%s picker reads through /api/projecthub/n3/:kind", async (kind) => {
    const up = upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1));
    const res = await handleProjectHubRequest(get(`n3/${kind}`), `n3/${kind}`);
    expect(res.status).toBe(200);
    expect(datasetCalls(kind, up.calls).length).toBeGreaterThan(0);
    // The picker keeps its own existing server permission.
    expect(pickerPermission(kind)).toBe(MASTER_SPECS[kind].businessPermission);
  });

  it.each(PICKERS)("%s picker fails closed without the required permission", async (kind) => {
    const up = upstreamFor(kind, () => payloadFor(kind, [SAMPLE[kind]], 1), false);
    const res = await handleProjectHubRequest(get(`n3/${kind}`, "", USER_TOKEN), `n3/${kind}`);
    expect(res.status).toBe(403);
    expect(datasetCalls(kind, up.calls)).toHaveLength(0);
  });

  it.each(["suppliers", "locations", "accounts", "terms"])(
    "%s is not exposed as a business picker",
    async (kind) => {
      upstreamFor(kind as MasterKind, () => n3Page([]));
      const res = await handleProjectHubRequest(get(`n3/${kind}`), `n3/${kind}`);
      expect(res.status).toBe(404);
    },
  );

  it("never takes tenant or actor authority from the request", async () => {
    upstreamFor("customers", () => n3Page([SAMPLE["customers"]], 1));
    const res = await handleProjectHubRequest(
      new Request(`${BASE}/master/customers?tenantId=attacker`, {
        headers: { authorization: `Bearer ${OWNER_TOKEN}`, "x-n3-tenant-id": "attacker-tenant" },
      }),
      "master/customers",
    );
    expect(res.status).toBe(400);
  });
});
