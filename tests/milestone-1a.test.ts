/**
 * Milestone 1A behaviour suite.
 *
 * Every N3 call is mocked: the suite never reaches a live N3 host, and no
 * write operation against N3 exists anywhere in the product surface.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const projects = await import("@/lib/projecthub-projects.server");
const boq = await import("@/lib/projecthub-boq.server");
const S = await import("@/lib/projecthub-schemas");
const calc = await import("@/lib/projecthub-calc");
const dates = await import("@/lib/projecthub-date");
const { permissionsForRole } = await import("@/lib/projecthub-rbac");
const { handleProjectHubRequest } = await import("@/lib/projecthub-api.server");

type Actor = Parameters<typeof projects.getDashboard>[0];

const PROJECT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SECTION_ID = "cccccccc-3333-4333-8333-cccccccccccc";
const PHASE_ID = "dddddddd-4444-4444-8444-dddddddddddd";
const ITEM_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

function actor(overrides: Partial<Actor> = {}): Actor {
  const role = (overrides.role ?? "owner") as Actor["role"];
  return {
    correlationId: "corr-test",
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

const liveProject = { id: PROJECT_ID, status: "enquiry", title: "Tower A" };

function setDb(
  fixtures: Record<string, { rows?: unknown[]; returning?: unknown; error?: { message: string } }>,
  rpc: Record<string, { data?: unknown; error?: { message: string } | null }> = {},
) {
  db = createMockSupabase(fixtures, rpc);
}

function calls(table: string, op?: string) {
  return db.calls.filter((c) => c.table === table && (op ? c.op === op : true));
}

beforeEach(() => setDb({}));
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
describe("dashboard", () => {
  it("scopes an assigned-only role to its own tenant and assigned projects", async () => {
    setDb({
      projecthub_project_team_members: { rows: [{ project_id: PROJECT_ID }] },
      projecthub_projects: { rows: [{ ...liveProject, updated_at: "2026-01-01" }] },
    });
    const result = await projects.getDashboard(actor({ role: "project_manager" }));
    expect(result.ok).toBe(true);
    const read = calls("projecthub_projects", "select")[0]!;
    expect(read.filters!["tenant_id"]).toBe("tenant-row-1");
    expect(read.filters!["id"]).toEqual([PROJECT_ID]);
  });

  it("returns an empty dashboard when an assigned-only role has no assignments", async () => {
    setDb({ projecthub_project_team_members: { rows: [] } });
    const result = await projects.getDashboard(actor({ role: "site_supervisor" }));
    expect(result).toMatchObject({
      ok: true,
      dashboard: { total: 0, enquiries: 0, active: 0, cancelled: 0, recent: [] },
    });
    expect(calls("projecthub_projects")).toHaveLength(0);
  });

  it("computes KPI counts and at most five recent projects for a tenant-wide role", async () => {
    const statuses = [
      "enquiry",
      "enquiry",
      "awarded",
      "planning",
      "in_progress",
      "cancelled_lost",
      "quotation",
    ];
    setDb({
      projecthub_projects: {
        rows: statuses.map((status, i) => ({
          id: `p${i}`,
          status,
          updated_at: `2026-01-0${i + 1}`,
        })),
      },
    });
    const result = await projects.getDashboard(actor());
    expect(result.ok && result.dashboard).toMatchObject({
      total: 7,
      enquiries: 2,
      active: 3,
      cancelled: 1,
    });
    expect(result.ok && result.dashboard.recent).toHaveLength(5);
    expect(calls("projecthub_projects", "select")[0]!.filters!["tenant_id"]).toBe("tenant-row-1");
  });
});

// ---------------------------------------------------------------------------
// Project update, cancellation and read-only enforcement
// ---------------------------------------------------------------------------
describe("project update and cancellation", () => {
  it("denies project editing to a role without the edit permission", async () => {
    setDb({
      projecthub_tenants: { returning: { id: "tenant-row-1" } },
      projecthub_user_roles: {
        rows: [{ role: "viewer", is_active: true, role_source: "assigned" }],
      },
    });
    mockUpstream(() => jsonResponse(basicInfo({ isOwner: false })));
    const res = await handleProjectHubRequest(
      new Request(`http://localhost:8080/api/projecthub/projects/${PROJECT_ID}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${OWNER_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      }),
      `projects/${PROJECT_ID}`,
    );
    expect(res.status).toBe(403);
    expect(calls("projecthub_projects", "update")).toHaveLength(0);
  });

  it("saves an allowed project edit with the tenant predicate", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject], returning: { ...liveProject, title: "Tower B" } },
    });
    const result = await projects.updateProject(actor(), PROJECT_ID, { title: "Tower B" });
    expect(result.ok).toBe(true);
    const update = calls("projecthub_projects", "update")[0]!;
    expect(update.filters).toMatchObject({ tenant_id: "tenant-row-1", id: PROJECT_ID });
  });

  it("requires a cancellation reason", () => {
    expect(S.cancelProjectSchema.safeParse({}).success).toBe(false);
    expect(S.cancelProjectSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(S.cancelProjectSchema.safeParse({ reason: "Client withdrew" }).success).toBe(true);
  });

  it("records the cancellation and refuses a second cancellation", async () => {
    setDb({
      projecthub_projects: {
        rows: [liveProject],
        returning: { ...liveProject, status: "cancelled_lost" },
      },
    });
    const first = await projects.cancelProject(actor(), PROJECT_ID, {
      reason: "Client withdrew",
      note: null,
    });
    expect(first.ok).toBe(true);

    setDb({ projecthub_projects: { rows: [{ ...liveProject, status: "cancelled_lost" }] } });
    const second = await projects.cancelProject(actor(), PROJECT_ID, {
      reason: "Client withdrew",
      note: null,
    });
    expect(second).toMatchObject({ ok: false, status: 409 });
  });

  it("makes a cancelled project read-only for project, phase, team and BOQ writes", async () => {
    const cancelled = {
      projecthub_projects: { rows: [{ ...liveProject, status: "cancelled_lost" }] },
    };

    setDb(cancelled);
    expect(await projects.updateProject(actor(), PROJECT_ID, { title: "x" })).toMatchObject({
      ok: false,
      status: 422,
    });

    setDb(cancelled);
    expect(
      await projects.createPhase(actor(), PROJECT_ID, {
        phaseName: "Phase 2",
        linkStatus: "unlinked",
      } as never),
    ).toMatchObject({ ok: false, status: 422 });

    setDb(cancelled);
    expect(await projects.assignTeamMember(actor(), PROJECT_ID, "user-guid-2")).toMatchObject({
      ok: false,
      status: 422,
    });

    setDb(cancelled);
    expect(await boq.createVersion(actor(), PROJECT_ID, {} as never)).toMatchObject({
      ok: false,
      status: 422,
    });

    setDb(cancelled);
    expect(
      await boq.createItem(actor(), PROJECT_ID, {
        boqVersionId: VERSION_ID,
        projectPhaseId: PHASE_ID,
        itemType: "labour",
        description: "Site labour",
        quantity: "1",
        costRate: "1",
        sellingRate: "1",
        lineNumber: 0,
      } as never),
    ).toMatchObject({ ok: false, status: 422 });
  });
});

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
describe("phases", () => {
  it("creates a phase with phase_kind 'phase'", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_project_phases: { returning: { id: PHASE_ID, phase_name: "Phase 2" } },
    });
    const result = await projects.createPhase(actor(), PROJECT_ID, {
      phaseName: "Phase 2",
      linkStatus: "unlinked",
    } as never);
    expect(result.ok).toBe(true);
    const insert = calls("projecthub_project_phases", "insert")[0]!;
    expect((insert.row as { phase_kind: string }).phase_kind).toBe("phase");
    expect((insert.row as { tenant_id: string }).tenant_id).toBe("tenant-row-1");
  });

  it("refuses to deactivate the primary phase", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_project_phases: {
        rows: [{ id: PHASE_ID, phase_kind: "primary", n3_project_id: null, is_active: true }],
      },
    });
    const result = await projects.updatePhase(actor(), PROJECT_ID, PHASE_ID, { isActive: false });
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(calls("projecthub_project_phases", "update")).toHaveLength(0);
  });

  it("re-resolves the N3 project code server-side and ignores browser display values", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_project_phases: { returning: { id: PHASE_ID, phase_name: "Phase 2" } },
    });
    mockUpstream(() =>
      jsonResponse({
        code: "0000",
        success: true,
        data: { value: [{ id: "n3-project-1", projectCode: "PRJ-001", projectName: "Tower A" }] },
      }),
    );
    const result = await projects.createPhase(actor(), PROJECT_ID, {
      phaseName: "Phase 2",
      linkStatus: "linked_existing",
      n3ProjectId: "n3-project-1",
      n3ProjectCode: "SPOOFED",
      n3ProjectName: "SPOOFED",
    } as never);
    expect(result.ok).toBe(true);
    const row = calls("projecthub_project_phases", "insert")[0]!.row as Record<string, unknown>;
    expect(row["n3_project_code"]).toBe("PRJ-001");
    expect(row["n3_project_name"]).toBe("Tower A");
  });

  it("rejects an N3 project id that cannot be verified in the live tenant", async () => {
    setDb({ projecthub_projects: { rows: [liveProject] } });
    mockUpstream(() => jsonResponse({ code: "0000", success: true, data: { value: [] } }));
    const result = await projects.createPhase(actor(), PROJECT_ID, {
      phaseName: "Phase 2",
      linkStatus: "linked_existing",
      n3ProjectId: "does-not-exist",
    } as never);
    expect(result).toMatchObject({ ok: false, status: 422 });
  });
});

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
describe("team", () => {
  it("accepts only an N3 user id — display values are rejected outright", () => {
    expect(S.assignTeamSchema.strict().safeParse({ n3UserId: "user-guid-2" }).success).toBe(true);
    expect(
      S.assignTeamSchema
        .strict()
        .safeParse({ n3UserId: "user-guid-2", displayName: "Spoof", role: "owner" }).success,
    ).toBe(false);
  });

  it("takes stored identity from the tenant role row, never the request", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_user_roles: {
        rows: [
          {
            role: "estimator",
            is_active: true,
            display_name: "Sara Estimator",
            display_email: "sara@acme.test",
          },
        ],
      },
      projecthub_project_team_members: { returning: { id: "member-1" } },
    });
    const result = await projects.assignTeamMember(actor(), PROJECT_ID, "user-guid-2");
    expect(result.ok).toBe(true);
    const row = calls("projecthub_project_team_members", "upsert")[0]!.row as Record<
      string,
      unknown
    >;
    expect(row["display_name"]).toBe("Sara Estimator");
    expect(row["display_email"]).toBe("sara@acme.test");
    expect(row["project_role_snapshot"]).toBe("estimator");
    expect(row["tenant_id"]).toBe("tenant-row-1");
  });

  it("refuses a target without an active, assigned ProjectHub role", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_user_roles: { rows: [{ role: "unassigned", is_active: true }] },
    });
    expect(await projects.assignTeamMember(actor(), PROJECT_ID, "user-guid-2")).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  it("deactivates a member without deleting the row", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_project_team_members: { returning: { id: "member-1" } },
    });
    expect(await projects.deactivateTeamMember(actor(), PROJECT_ID, "user-guid-2")).toMatchObject({
      ok: true,
    });
    const update = calls("projecthub_project_team_members", "update")[0]!;
    expect((update.row as { is_active: boolean }).is_active).toBe(false);
    expect(calls("projecthub_project_team_members", "delete")).toHaveLength(0);
  });

  it("lists only active, role-holding tenant users as candidates", async () => {
    setDb({
      projecthub_user_roles: {
        rows: [
          {
            n3_user_id: "u1",
            role: "estimator",
            is_active: true,
            display_name: "A",
            display_email: null,
          },
          {
            n3_user_id: "u2",
            role: "unassigned",
            is_active: true,
            display_name: "B",
            display_email: null,
          },
        ],
      },
    });
    const result = await projects.listTeamCandidates(actor());
    expect(result.ok && result.candidates.map((c) => c.n3UserId)).toEqual(["u1"]);
  });
});

// ---------------------------------------------------------------------------
// Simple budget
// ---------------------------------------------------------------------------
describe("simple budget", () => {
  it("computes exact profit and gross margin", () => {
    expect(calc.simpleBudgetTotals("125000.50", "160000.75")).toEqual({
      totalCost: "125000.50",
      totalSelling: "160000.75",
      grossProfit: "35000.25",
      grossMarginPercent: "21.88",
    });
  });

  it("returns a null margin when there is no selling value", () => {
    expect(calc.simpleBudgetTotals("100.00", null).grossMarginPercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BOQ
// ---------------------------------------------------------------------------
describe("BOQ versions and sections", () => {
  it("creates the first version as draft revision 1", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [], returning: { id: VERSION_ID, version_number: 1 } },
    });
    const result = await boq.createVersion(actor(), PROJECT_ID, {} as never);
    expect(result.ok).toBe(true);
    const row = calls("projecthub_boq_versions", "insert")[0]!.row as Record<string, unknown>;
    expect(row["version_number"]).toBe(1);
    expect(row["revision_label"]).toBe("Rev 1");
    expect(row["status"]).toBe("draft");
  });

  it("clones an existing version through the atomic database routine", async () => {
    setDb(
      {
        projecthub_projects: { rows: [liveProject] },
        projecthub_boq_versions: { rows: [{ id: VERSION_ID, status: "draft", version_number: 1 }] },
      },
      { projecthub_clone_boq_version: { data: "new-version-id", error: null } },
    );
    const result = await boq.cloneVersion(actor(), PROJECT_ID, {
      sourceVersionId: VERSION_ID,
      revisionLabel: "Rev 2",
    });
    expect(result).toMatchObject({ ok: true, versionId: "new-version-id" });
    const rpc = calls("rpc:projecthub_clone_boq_version")[0]!.row as Record<string, unknown>;
    expect(rpc["p_tenant_id"]).toBe("tenant-row-1");
    expect(rpc["p_project_id"]).toBe(PROJECT_ID);
  });

  it("treats a superseded version as read-only", async () => {
    const superseded = {
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: {
        rows: [{ id: VERSION_ID, status: "superseded", version_number: 1 }],
      },
    };

    setDb(superseded);
    expect(await boq.updateVersion(actor(), PROJECT_ID, VERSION_ID, { notes: "x" })).toMatchObject({
      ok: false,
      status: 422,
    });

    setDb(superseded);
    expect(
      await boq.createSection(actor(), PROJECT_ID, {
        boqVersionId: VERSION_ID,
        name: "Substructure",
        sortOrder: 0,
      } as never),
    ).toMatchObject({ ok: false, status: 422 });

    setDb(superseded);
    expect(
      await boq.createItem(actor(), PROJECT_ID, {
        boqVersionId: VERSION_ID,
        projectPhaseId: PHASE_ID,
        itemType: "labour",
        description: "Labour",
        quantity: "1",
        costRate: "1",
        sellingRate: "1",
        lineNumber: 0,
      } as never),
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects an unknown version and creates a section inside a draft version", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [] },
    });
    expect(
      await boq.createSection(actor(), PROJECT_ID, {
        boqVersionId: VERSION_ID,
        name: "Substructure",
        sortOrder: 0,
      } as never),
    ).toMatchObject({ ok: false, status: 404 });

    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [{ id: VERSION_ID, status: "draft", version_number: 1 }] },
      projecthub_boq_sections: { returning: { id: SECTION_ID, name: "Substructure" } },
    });
    const created = await boq.createSection(actor(), PROJECT_ID, {
      boqVersionId: VERSION_ID,
      name: "Substructure",
      sortOrder: 0,
    } as never);
    expect(created.ok).toBe(true);
    const row = calls("projecthub_boq_sections", "insert")[0]!.row as Record<string, unknown>;
    expect(row["tenant_id"]).toBe("tenant-row-1");
    expect(row["project_id"]).toBe(PROJECT_ID);
  });
});

describe("BOQ items", () => {
  const baseItem = {
    boqVersionId: VERSION_ID,
    projectPhaseId: PHASE_ID,
    lineNumber: 1,
    description: "Ready-mix concrete",
    quantity: "10",
    costRate: "100",
    sellingRate: "150",
  };

  it("requires exactly one stock deduction method on a material line", () => {
    expect(S.createBoqItemSchema.safeParse({ ...baseItem, itemType: "material" }).success).toBe(
      false,
    );
    for (const method of S.STOCK_DEDUCTION_METHODS) {
      expect(
        S.createBoqItemSchema.safeParse({
          ...baseItem,
          itemType: "material",
          stockDeductionMethod: method,
        }).success,
        method,
      ).toBe(true);
    }
    expect(S.STOCK_DEDUCTION_METHODS).toHaveLength(4);
  });

  it("rejects stock fields on a non-material line and clears them before validation", () => {
    expect(
      S.createBoqItemSchema.safeParse({
        ...baseItem,
        itemType: "labour",
        stockDeductionMethod: "stock_out",
      }).success,
    ).toBe(false);

    const prepared = boq.prepareItemInput({
      ...baseItem,
      itemType: "labour",
      n3StockId: "stock-1",
      stockDeductionMethod: "stock_out",
    });
    expect(prepared["n3StockId"]).toBeNull();
    expect(prepared["stockDeductionMethod"]).toBeNull();
    expect(S.createBoqItemSchema.safeParse(prepared).success).toBe(true);
  });

  it("validates version, phase and section ownership before inserting a line", async () => {
    const item = { ...baseItem, itemType: "labour" } as never;

    setDb({ projecthub_projects: { rows: [liveProject] }, projecthub_boq_versions: { rows: [] } });
    expect(await boq.createItem(actor(), PROJECT_ID, item)).toMatchObject({
      ok: false,
      status: 404,
    });

    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [{ id: VERSION_ID, status: "draft", version_number: 1 }] },
      projecthub_project_phases: { rows: [] },
    });
    expect(await boq.createItem(actor(), PROJECT_ID, item)).toMatchObject({
      ok: false,
      status: 422,
    });

    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [{ id: VERSION_ID, status: "draft", version_number: 1 }] },
      projecthub_project_phases: { rows: [{ id: PHASE_ID }] },
      projecthub_boq_sections: { rows: [] },
    });
    expect(
      await boq.createItem(actor(), PROJECT_ID, { ...item, sectionId: SECTION_ID } as never),
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("re-resolves stock, UOM and tax identity from live N3 and ignores browser snapshots", async () => {
    setDb({
      projecthub_projects: { rows: [liveProject] },
      projecthub_boq_versions: { rows: [{ id: VERSION_ID, status: "draft", version_number: 1 }] },
      projecthub_project_phases: { rows: [{ id: PHASE_ID }] },
      projecthub_boq_items: { returning: { id: ITEM_ID } },
    });
    mockUpstream((url) => {
      if (url.includes("Stock"))
        return jsonResponse({
          code: "0000",
          success: true,
          data: { value: [{ id: "stock-1", stockCode: "CONC-30", description: "Concrete G30" }] },
        });
      if (url.includes("UOM") || url.includes("Uom"))
        return jsonResponse({
          code: "0000",
          success: true,
          data: { value: [{ id: "uom-1", code: "M3", name: "Cubic metre" }] },
        });
      return jsonResponse({
        code: "0000",
        success: true,
        data: { value: [{ id: "tax-1", taxCode: "SST", rate: "6" }] },
      });
    });

    const result = await boq.createItem(actor(), PROJECT_ID, {
      ...baseItem,
      itemType: "material",
      stockDeductionMethod: "delivery_order",
      n3StockId: "stock-1",
      n3UomId: "uom-1",
      n3TaxCodeId: "tax-1",
      stockCode: "SPOOF",
      taxRate: "99",
    } as never);
    expect(result.ok).toBe(true);
    const row = calls("projecthub_boq_items", "insert")[0]!.row as Record<string, unknown>;
    expect(row["stock_code"]).toBe("CONC-30");
    expect(row["uom_code"]).toBe("M3");
    expect(row["tax_code"]).toBe("SST");
    expect(row["tax_rate"]).toBe("6");
    expect(row["stock_deduction_method"]).toBe("delivery_order");
  });

  it("computes exact line totals for the editor preview", () => {
    expect(
      calc.calculateLine({
        itemType: "material",
        quantity: "10",
        costRate: "100",
        sellingRate: "150",
        taxRate: "6",
      }),
    ).toMatchObject({
      costAmount: "1000.00",
      sellingAmount: "1500.00",
      taxAmount: "90.00",
      sellingAmountWithTax: "1590.00",
      grossProfit: "500.00",
    });
  });
});

// ---------------------------------------------------------------------------
// Malaysia calendar
// ---------------------------------------------------------------------------
describe("Malaysia date handling", () => {
  it("uses Asia/Kuala_Lumpur for today's date across the UTC midnight boundary", () => {
    expect(dates.malaysiaToday(new Date("2025-12-31T17:00:00Z"))).toBe("2026-01-01");
    expect(dates.malaysiaToday(new Date("2026-01-01T15:59:00Z"))).toBe("2026-01-01");
    expect(dates.malaysiaToday(new Date("2026-01-01T16:00:00Z"))).toBe("2026-01-02");
  });

  it("derives the enquiry reference year from the enquiry date, else Malaysia time", () => {
    expect(dates.malaysiaYear(new Date("2025-12-31T17:00:00Z"))).toBe(2026);
    expect(dates.enquiryReferenceYear(null, new Date("2025-12-31T17:00:00Z"))).toBe(2026);
    expect(dates.enquiryReferenceYear("2025-06-01", new Date("2026-02-01T00:00:00Z"))).toBe(2025);
    expect(dates.enquiryReferenceYear("not-a-date", new Date("2025-12-31T17:00:00Z"))).toBe(2026);
  });
});

// ---------------------------------------------------------------------------
// Architecture guards
// ---------------------------------------------------------------------------
describe("browser Supabase architecture guards", () => {
  const root = process.cwd();

  it("has no Supabase browser auth modules", () => {
    for (const file of [
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/auth-attacher.ts",
      "src/integrations/supabase/auth-middleware.ts",
    ]) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
  });

  it("keeps functionMiddleware empty in src/start.ts", () => {
    const src = readFileSync(join(root, "src/start.ts"), "utf8");
    expect(src).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(src).not.toContain("attachSupabaseAuth");
  });
});
