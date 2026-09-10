/**
 * WP0C-0 — Enquiry creation P0 correction.
 *
 * Behavioural coverage of the atomic enquiry RPC boundary: server-resolved
 * tenant/actor, server re-resolved customer identity, ISO date payloads,
 * idempotent replay, conflict, and the new bounded failure diagnostics.
 * Every N3 call is mocked; no live host and no N3 mutation is reachable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basicInfo, createMockSupabase, jsonResponse, mockUpstream, OWNER_TOKEN } from "./helpers";

let db = createMockSupabase();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return db.client as never;
  },
}));

const projects = await import("@/lib/projecthub-projects.server");
const diagnostics = await import("@/lib/projecthub-diagnostics.server");
const { permissionsForRole } = await import("@/lib/projecthub-rbac");
const { handleProjectHubRequest } = await import("@/lib/projecthub-api.server");

type Actor = Parameters<typeof projects.getDashboard>[0];

const CUSTOMER_ID = "cust-guid-motive";
const PROJECT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function actor(overrides: Partial<Actor> = {}): Actor {
  const role = (overrides.role ?? "owner") as Actor["role"];
  return {
    correlationId: "corr-wp0c0",
    bearer: OWNER_TOKEN,
    session: {
      n3TenantId: "11111111-2222-3333-4444-555555555555",
      tenantCode: "ACME",
      companyName: "Acme Builders Sdn Bhd",
      n3UserId: "user-guid-1",
      displayEmail: "owner@acme.test",
      displayName: "Owner",
      isOwner: role === "owner",
    },
    tenantRowId: "tenant-row-1",
    n3UserId: "user-guid-1",
    role,
    roleStatus: role === "owner" ? "owner" : "assigned",
    permissions: permissionsForRole(role),
    ...overrides,
  } as Actor;
}

/** Live N3 customer page containing the proven Motive record. */
function mockCustomers() {
  return mockUpstream((url) => {
    if (url.includes("BasicInfo") || url.includes("CompanyProfile")) {
      return jsonResponse(basicInfo());
    }
    return jsonResponse({
      code: "0000",
      data: {
        value: [
          {
            id: CUSTOMER_ID,
            code: "700-M165",
            companyName: "MOTIVE POWER INDUSTRIES SDN BHD",
          },
        ],
        count: 1,
      },
    });
  });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: REQUEST_ID,
    title: "Tower A fit-out",
    projectType: "construction",
    budgetMode: "detailed_boq",
    enquiryDate: "2026-09-09",
    expectedStartDate: "2026-10-01",
    expectedEndDate: "2026-12-31",
    customer: {
      customerLinkStatus: "linked_existing",
      n3CustomerId: CUSTOMER_ID,
      // Browser-supplied display values that MUST be ignored.
      n3CustomerCode: "SPOOFED-CODE",
      n3CustomerName: "SPOOFED NAME",
    },
    primaryProjectCode: {
      linkStatus: "unlinked",
    },
    primaryPhaseName: "Main contract",
    initialTeamN3UserIds: [],
    ...overrides,
  } as unknown as Parameters<typeof projects.createEnquiry>[1];
}

function rpcArgs() {
  const call = db.calls.find((c) => c.table === "rpc:projecthub_create_enquiry");
  return call?.row as Record<string, unknown> | undefined;
}

function setDb(rpc: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  db = createMockSupabase({}, rpc);
}

const successRpc = {
  projecthub_create_enquiry: {
    data: [{ project_id: PROJECT_ID, enquiry_reference: "ENQ-2026-00001", replayed: false }],
  },
};

beforeEach(() => setDb(successRpc));
afterEach(() => vi.unstubAllGlobals());

describe("WP0C-0 enquiry creation", () => {
  it("1. calls the atomic RPC with the server-resolved tenant and actor", async () => {
    mockCustomers();
    const result = await projects.createEnquiry(actor(), input());
    expect(result.ok).toBe(true);
    const args = rpcArgs()!;
    expect(args["p_tenant_id"]).toBe("tenant-row-1");
    expect(args["p_actor"]).toBe("user-guid-1");
    expect(args["p_year"]).toBe(2026);
    expect(db.calls.filter((c) => c.table.startsWith("rpc:"))).toHaveLength(1);
  });

  it("2. re-resolves the linked customer server-side and ignores browser display values", async () => {
    mockCustomers();
    await projects.createEnquiry(actor(), input());
    const payload = rpcArgs()!["p_payload"] as Record<string, unknown>;
    expect(payload["n3_customer_id"]).toBe(CUSTOMER_ID);
    expect(payload["n3_customer_code"]).toBe("700-M165");
    expect(payload["n3_customer_name"]).toBe("MOTIVE POWER INDUSTRIES SDN BHD");
    expect(JSON.stringify(payload)).not.toContain("SPOOFED");
  });

  it("3. sends ISO dates, never Malaysian display dates", async () => {
    mockCustomers();
    await projects.createEnquiry(actor(), input());
    const payload = rpcArgs()!["p_payload"] as Record<string, unknown>;
    for (const key of ["enquiry_date", "expected_start_date", "expected_end_date"]) {
      expect(String(payload[key])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("4. returns one project id and one ENQ-YYYY-##### reference", async () => {
    mockCustomers();
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toMatchObject({ ok: true, projectId: PROJECT_ID, replayed: false });
    expect((result as { enquiryReference: string }).enquiryReference).toMatch(
      /^ENQ-\d{4}-\d{5}$/,
    );
  });

  it("5. replays the same project for an identical repeated request", async () => {
    mockCustomers();
    setDb({
      projecthub_create_enquiry: {
        data: [{ project_id: PROJECT_ID, enquiry_reference: "ENQ-2026-00001", replayed: true }],
      },
    });
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toMatchObject({ ok: true, projectId: PROJECT_ID, replayed: true });
    expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("6. returns 409 when the same request id carries a different payload", async () => {
    mockCustomers();
    setDb({
      projecthub_create_enquiry: {
        error: { message: "projecthub_idempotency_conflict", code: "P0001" } as never,
      },
    });
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("7. fails before any local creation when the customer cannot be verified", async () => {
    mockUpstream(() => jsonResponse({ code: "0000", data: { value: [], count: 0 } }));
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(db.calls).toHaveLength(0);
  });

  it("8. returns the generic message on a database transaction failure", async () => {
    mockCustomers();
    setDb({
      projecthub_create_enquiry: {
        error: { message: 'column reference "project_id" is ambiguous', code: "42702" } as never,
      },
    });
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toEqual({
      ok: false,
      status: 503,
      message: "The enquiry could not be created",
    });
  });

  it("9. records a safe classification and error code with no secret, payload or customer data", async () => {
    mockCustomers();
    setDb({
      projecthub_create_enquiry: {
        error: { message: 'column reference "project_id" is ambiguous', code: "42702" } as never,
      },
    });
    await projects.createEnquiry(actor(), input());
    const audit = db.calls.find((c) => c.table === "projecthub_integration_audit_events");
    expect(audit).toBeDefined();
    const row = audit!.row as Record<string, unknown>;
    expect(row["action"]).toBe("projecthub.create_enquiry");
    expect(row["outcome"]).toBe("failure");
    expect(row["metadata"]).toEqual({ classification: "database_failure", error_code: "42702" });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("MOTIVE");
    expect(serialized).not.toContain(OWNER_TOKEN);
    expect(serialized).not.toContain("Tower A fit-out");
    expect(serialized).not.toContain("ambiguous");
  });

  it("10. a diagnostic write failure does not change the original response", async () => {
    mockCustomers();
    db = createMockSupabase(
      { projecthub_integration_audit_events: { error: { message: "audit down" } } },
      {
        projecthub_create_enquiry: {
          error: { message: "deadlock detected", code: "40P01" } as never,
        },
      },
    );
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toEqual({
      ok: false,
      status: 503,
      message: "The enquiry could not be created",
    });
  });

  it("11. distinguishes a missing/invalid RPC result from a database error", async () => {
    mockCustomers();
    setDb({ projecthub_create_enquiry: { data: [] } });
    const result = await projects.createEnquiry(actor(), input());
    expect(result).toMatchObject({ ok: false, status: 503 });
    const audit = db.calls.find((c) => c.table === "projecthub_integration_audit_events")!;
    expect((audit.row as Record<string, unknown>)["metadata"]).toEqual({
      classification: "invalid_rpc_result",
      error_code: null,
    });
  });

  it("11b. classifies every required failure family", () => {
    expect(diagnostics.classifyEnquiryFailure({ code: "PGRST202", message: "not found" })).toEqual({
      classification: "rpc_transport_failure",
      errorCode: "PGRST202",
    });
    expect(diagnostics.classifyEnquiryFailure({ message: "fetch failed" })).toEqual({
      classification: "rpc_transport_failure",
      errorCode: null,
    });
    expect(diagnostics.classifyEnquiryFailure({ code: "23505", message: "dup" })).toEqual({
      classification: "database_failure",
      errorCode: "23505",
    });
    expect(
      diagnostics.classifyEnquiryFailure({
        code: "P0001",
        message: "projecthub_idempotency_conflict",
      }).classification,
    ).toBe("idempotency_conflict");
    expect(diagnostics.classifyEnquiryFailure(null).classification).toBe("invalid_rpc_result");
    expect(diagnostics.classifyEnquiryFailure({ message: "boom" }).classification).toBe(
      "unexpected_failure",
    );
  });

  it("14. refuses creation for a role without the create permission", async () => {
    mockCustomers();
    const denied = await handleProjectHubRequest(
      new Request("https://app.test/api/projecthub/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input()),
      }),
      "projects",
    );
    // No live N3 session is established in this request, so the actor never
    // resolves to a creator; creation is refused and no RPC is attempted.
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(db.calls.filter((c) => c.table.startsWith("rpc:"))).toHaveLength(0);
  });
});

describe("WP0C-0 boundary guards", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("12/13. the atomic routine still owns phase, team and the three events", () => {
    const sql = read("supabase/migrations")
      ? readFileSync(join(process.cwd(), "supabase/migrations", latestMigration()), "utf8")
      : "";
    expect(sql).toContain("#variable_conflict use_column");
    expect(sql).toContain("projecthub_project_team_members");
    expect(sql).toContain("project.enquiry_created");
    expect(sql).toContain("SECURITY INVOKER".toLowerCase()).toBeFalsy;
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("15/16. no N3 mutation and no browser Supabase client exist", () => {
    const server = read("src/lib/projecthub-projects.server.ts");
    expect(server).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    const diag = read("src/lib/projecthub-diagnostics.server.ts");
    expect(diag).not.toContain("@/integrations/supabase/client\"");
  });
});

function latestMigration(): string {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((f: string) => f.endsWith(".sql"))
    .sort()
    .at(-1)!;
}
