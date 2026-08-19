/**
 * Read-only quotation API behaviour.
 *
 * These are real behavioural tests: they drive `handleProjectHubRequest` and
 * the quotation service against a chainable Supabase double and a mocked N3
 * upstream. No live N3 host and no mutation is ever reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  basicInfo,
  createMockSupabase,
  jsonResponse,
  mockUpstream,
  OWNER_TOKEN,
  USER_TOKEN,
} from "./helpers";

let db = createMockSupabase();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return db.client as never;
  },
}));

const { getQuotationPreview } = await import("@/lib/projecthub-quotation.server");
const { handleProjectHubRequest } = await import("@/lib/projecthub-api.server");
const { permissionsForRole } = await import("@/lib/projecthub-rbac");

const PROJECT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_PROJECT_ID = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SECTION_ID = "cccccccc-3333-4333-8333-cccccccccccc";

type Actor = Parameters<typeof getQuotationPreview>[0];

function actor(overrides: Partial<Actor> = {}): Actor {
  const role = (overrides.role ?? "owner") as Actor["role"];
  return {
    correlationId: "corr-quotation",
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

const project = {
  id: PROJECT_ID,
  title: "Clubhouse renovation",
  enquiry_reference: "ENQ-2026-00001",
  status: "enquiry",
  budget_mode: "detailed_boq",
  n3_customer_id: "N3-CUST-1",
  n3_customer_name: "Acme Sdn Bhd",
  requested_customer_name: null,
  site_address_line1: "1 Jalan Satu",
  site_city: "Kuala Lumpur",
  site_postcode: "50000",
  // Internal-only fields that must never reach the customer DTO.
  internal_notes: "margin squeezed",
  n3_project_id: "N3-PROJ-1",
};

const readyVersion = {
  id: VERSION_ID,
  version_number: 2,
  revision_label: "Rev B",
  status: "ready_for_review",
};

const items = [
  {
    id: "item-1",
    section_id: SECTION_ID,
    line_number: 1,
    description: "Site setup",
    quantity: "2.0000",
    uom_code: "LOT",
    uom_name: "Lot",
    selling_rate: "1250.5000",
    tax_code: "SR",
    tax_rate: "6.0000",
    cost_rate: "900.0000",
    stock_deduction_method: "delivery_order",
    n3_stock_id: "STK-1",
  },
];

function setDb(fixtures: Record<string, { rows?: unknown[]; error?: { message: string } }>) {
  db = createMockSupabase(fixtures as never);
}

function readyFixtures(overrides: Record<string, { rows?: unknown[] }> = {}) {
  return {
    projecthub_projects: { rows: [project] },
    projecthub_project_phases: {
      rows: [
        {
          id: "phase-1",
          phase_kind: "primary",
          phase_name: "Main contract",
          is_active: true,
          link_status: "linked_existing",
          n3_project_id: "N3-PROJ-1",
        },
      ],
    },
    projecthub_boq_versions: { rows: [readyVersion] },
    projecthub_boq_sections: { rows: [{ id: SECTION_ID, code: "A", name: "Preliminaries", sort_order: 1 }] },
    projecthub_boq_items: { rows: items },
    ...overrides,
  };
}

beforeEach(() => setDb({}));
afterEach(() => vi.unstubAllGlobals());

describe("quotation preview service", () => {
  it("returns an exact, customer-safe document for a ready BOQ", async () => {
    setDb(readyFixtures());
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.quotation;
    expect(q.previewReady).toBe(true);
    expect(q.futurePostingReady).toBe(true);
    expect(q.postingState).toBe("not_posted");
    expect(q.notPostedToN3Label).toBe("Not posted to N3");

    const doc = q.document!;
    expect(doc.enquiryReference).toBe("ENQ-2026-00001");
    expect(doc.customerDisplayName).toBe("Acme Sdn Bhd");
    expect(doc.primaryPhaseName).toBe("Main contract");
    expect(doc.sections).toHaveLength(1);

    // Deterministic BigInt arithmetic: 2 x 1250.50 = 2501.00, tax 6% = 150.06.
    const line = doc.sections[0]!.lines[0]!;
    expect(line.sellingAmount).toBe("2501.00");
    expect(line.taxAmount).toBe("150.06");
    expect(line.amountWithTax).toBe("2651.06");
    expect(doc.totals).toEqual({ selling: "2501.00", tax: "150.06", total: "2651.06" });
  });

  it("redacts every internal cost, margin and N3 identifier from the DTO", async () => {
    setDb(readyFixtures());
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialised = JSON.stringify(result.quotation);
    for (const forbidden of [
      "cost_rate",
      "costRate",
      "900.0000",
      "grossProfit",
      "grossMargin",
      "markup",
      "internal_notes",
      "margin squeezed",
      "n3_customer_id",
      "N3-CUST-1",
      "N3-PROJ-1",
      "STK-1",
      "stock_deduction_method",
      "tenant-row-1",
      "ACME",
      "owner@acme.test",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("performs no mutation of any kind", async () => {
    setDb(readyFixtures());
    const upstream = mockUpstream(() => jsonResponse(basicInfo()));
    await getQuotationPreview(actor(), PROJECT_ID);
    expect(db.calls.every((call) => call.op === "select")).toBe(true);
    expect(upstream.calls).toHaveLength(0);
  });

  it("scopes every read to the resolved tenant and project", async () => {
    setDb(readyFixtures());
    await getQuotationPreview(actor(), PROJECT_ID);
    for (const call of db.calls) {
      expect(call.filters).toMatchObject({ tenant_id: "tenant-row-1" });
    }
    for (const table of [
      "projecthub_project_phases",
      "projecthub_boq_versions",
      "projecthub_boq_sections",
      "projecthub_boq_items",
    ]) {
      const call = db.calls.find((c) => c.table === table)!;
      expect(call.filters).toMatchObject({ project_id: PROJECT_ID });
    }
  });

  it("returns 404 for a project outside the actor's tenant", async () => {
    setDb({ projecthub_projects: { rows: [] } });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("returns 404 for an assigned-scope role on an unassigned project", async () => {
    setDb({
      projecthub_projects: { rows: [{ ...project, id: OTHER_PROJECT_ID }] },
      projecthub_project_team_members: { rows: [{ project_id: PROJECT_ID }] },
    });
    const result = await getQuotationPreview(actor({ role: "estimator" } as Partial<Actor>), OTHER_PROJECT_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("blocks the preview for a cancelled project", async () => {
    setDb({ ...readyFixtures(), projecthub_projects: { rows: [{ ...project, status: "cancelled_lost" }] } });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.document).toBeNull();
    expect(result.quotation.blockers.map((b) => b.code)).toContain("project_cancelled");
  });

  it("blocks the preview in Simple Budget mode", async () => {
    setDb({ ...readyFixtures(), projecthub_projects: { rows: [{ ...project, budget_mode: "simple_budget" }] } });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.blockers.map((b) => b.code)).toContain("simple_budget_mode");
  });

  it("blocks the preview while the current version is still a draft", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_boq_versions: { rows: [{ ...readyVersion, status: "draft" }] },
    });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.document).toBeNull();
    expect(result.quotation.blockers.map((b) => b.code)).toContain("boq_not_ready_for_review");
  });

  it("never falls back to a superseded version", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_boq_versions: {
        rows: [
          { id: "v3", version_number: 3, revision_label: "Rev C", status: "superseded" },
          readyVersion,
        ],
      },
    });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.document?.revisionLabel).toBe("Rev B");
  });

  it("reports an unlinked N3 customer as a future-posting blocker only", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_projects: {
        rows: [{ ...project, n3_customer_id: null, requested_customer_name: "Prospect Sdn Bhd" }],
      },
    });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.previewReady).toBe(true);
    expect(result.quotation.futurePostingReady).toBe(false);
    const blocker = result.quotation.blockers.find((b) => b.code === "n3_customer_not_linked")!;
    expect(blocker.scope).toBe("future_posting");
  });

  it("blocks the preview when there are no positive quotation lines", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_boq_items: { rows: [{ ...items[0], quantity: "0.0000", selling_rate: "0.0000" }] },
    });
    const result = await getQuotationPreview(actor(), PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quotation.blockers.map((b) => b.code)).toContain("no_quotation_lines");
  });
});

describe("quotation preview HTTP route", () => {
  function request(method = "GET", token = OWNER_TOKEN) {
    return handleProjectHubRequest(
      new Request(`http://localhost:8080/api/projecthub/projects/${PROJECT_ID}/quotation-preview`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      }),
      `projects/${PROJECT_ID}/quotation-preview`,
    );
  }

  it("serves the preview to an Owner", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_tenants: { rows: [{ id: "tenant-row-1" }] },
      projecthub_user_roles: { rows: [{ role: "owner", is_active: true, role_source: "owner" }] },
    } as never);
    mockUpstream(() => jsonResponse(basicInfo()));
    const res = await request();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quotation?: { postingState?: string } };
    expect(body.quotation?.postingState).toBe("not_posted");
  });

  it("denies a role without projecthub:boq:view", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_tenants: { rows: [{ id: "tenant-row-1" }] },
      projecthub_user_roles: {
        rows: [{ role: "site_supervisor", is_active: true, role_source: "assigned" }],
      },
    } as never);
    mockUpstream(() => jsonResponse(basicInfo({ isOwner: false })));
    const res = await request("GET", USER_TOKEN);
    expect(res.status).toBe(403);
  });

  it("rejects any non-GET method on the quotation route", async () => {
    setDb({
      ...readyFixtures(),
      projecthub_tenants: { rows: [{ id: "tenant-row-1" }] },
      projecthub_user_roles: { rows: [{ role: "owner", is_active: true, role_source: "owner" }] },
    } as never);
    mockUpstream(() => jsonResponse(basicInfo()));
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await request(method);
      expect(res.status).toBe(405);
    }
    expect(db.calls.every((call) => call.op === "select")).toBe(true);
  });

  it("denies an unauthenticated request", async () => {
    setDb(readyFixtures() as never);
    const res = await handleProjectHubRequest(
      new Request(
        `http://localhost:8080/api/projecthub/projects/${PROJECT_ID}/quotation-preview`,
        { method: "GET" },
      ),
      `projects/${PROJECT_ID}/quotation-preview`,
    );
    expect(res.status).toBe(401);
  });
});
