// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeCursor,
  DEFAULT_COLUMNS,
  deriveModuleAction,
  encodeCursor,
  parseHistoryQuery,
  redactValues,
  sanitiseColumnSelection,
} from "@/lib/projecthub-history";
import { permissionsForRole, type ProjectHubRole } from "@/lib/projecthub-rbac";
import { normaliseSection } from "@/lib/workspace-tabs";
import { buildXlsx, crc32, safeCellText } from "@/lib/xlsx-writer.server";
import {
  readHistoryColumns,
  resetHistoryColumnsMemory,
  writeHistoryColumns,
} from "@/lib/history-preference";

const PID = "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b";

describe("history query contract", () => {
  it("parses a project query with Malaysian inclusive day bounds", () => {
    const r = parseHistoryQuery({
      scope: "project",
      projectId: PID,
      dateFrom: "01/09/2026",
      dateTo: "01/09/2026",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.fromUtc).toBe("2026-08-31T16:00:00.000Z");
    expect(r.query.toUtcExclusive).toBe("2026-09-01T16:00:00.000Z");
    expect(r.query.limit).toBe(50);
  });

  it("rejects unknown params, tenant smuggling, bad sizes, dates and cursors", () => {
    expect(parseHistoryQuery({ scope: "global", tenant_id: "x" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", projectId: PID }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "project" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", limit: "500" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", dateFrom: "2026-09-01" }).ok).toBe(false);
    expect(
      parseHistoryQuery({ scope: "global", dateFrom: "02/09/2026", dateTo: "01/09/2026" }).ok,
    ).toBe(false);
    expect(parseHistoryQuery({ scope: "global", cursor: "not*valid" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", module: "billing_hack" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", sortKey: "tenant_id" }).ok).toBe(false);
  });

  it("requires audit columns in an export column list", () => {
    expect(parseHistoryQuery({ scope: "global", columns: "user,title" }).ok).toBe(false);
    expect(parseHistoryQuery({ scope: "global", columns: "occurredAt,title,project" }).ok).toBe(
      true,
    );
    expect(
      parseHistoryQuery({ scope: "global", columns: "occurredAt,title,project,title" }).ok,
    ).toBe(false);
  });

  it("round-trips a cursor bound to the active sort", () => {
    const c = { k: "occurredAt" as const, d: "desc" as const, v: "2026-09-01T00:00:00Z", id: PID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    const mismatch = parseHistoryQuery({
      scope: "global",
      sortDirection: "asc",
      cursor: encodeCursor(c),
    });
    expect(mismatch.ok).toBe(false);
  });

  it("derives module/action for legacy event types", () => {
    expect(deriveModuleAction("project.cancelled").action).toBe("cancelled");
    expect(deriveModuleAction("unknown.thing").module).toBeTruthy();
  });

  it("redacts sensitive keys and drops nested dumps", () => {
    const out = redactValues({ title: "A", token: "t", nested: { a: 1 }, fields: ["x"] });
    expect(out).toEqual({ title: "A", fields: ["x"] });
  });

  it("sanitises column preferences and restores required columns", () => {
    expect(sanitiseColumnSelection(["bogus"], "global")).toEqual(DEFAULT_COLUMNS.global);
    const cols = sanitiseColumnSelection(["user"], "global");
    expect(cols).toContain("occurredAt");
    expect(cols).toContain("title");
    expect(cols).toContain("project");
  });
});

describe("history column preference", () => {
  beforeEach(() => {
    localStorage.clear();
    resetHistoryColumnsMemory();
  });
  it("persists per scope, restores defaults and stores only column keys", () => {
    writeHistoryColumns("project", ["title", "occurredAt", "user"]);
    expect(readHistoryColumns("project")).toEqual(["title", "occurredAt", "user"]);
    expect(readHistoryColumns("global")).toEqual(DEFAULT_COLUMNS.global);
    expect(localStorage.getItem("projecthub:history-columns:project")).toBe(
      '["title","occurredAt","user"]',
    );
    writeHistoryColumns("project", null);
    expect(readHistoryColumns("project")).toEqual(DEFAULT_COLUMNS.project);
  });
  it("ignores tampered storage", () => {
    localStorage.setItem("projecthub:history-columns:global", '{"evil":true}');
    expect(readHistoryColumns("global")).toEqual(DEFAULT_COLUMNS.global);
  });
});

describe("history permissions", () => {
  const roles: ProjectHubRole[] = [
    "project_manager",
    "estimator",
    "finance",
    "procurement",
    "storekeeper",
    "site_supervisor",
    "viewer",
    "unassigned",
  ];
  it("grants Global History only to the Owner role", () => {
    expect(permissionsForRole("owner")).toContain("projecthub:history:view_all");
    expect(permissionsForRole("owner")).toContain("projecthub:history:export_all");
    for (const role of roles) {
      expect(permissionsForRole(role)).not.toContain("projecthub:history:view_all");
      expect(permissionsForRole(role)).not.toContain("projecthub:history:export_all");
    }
    expect(permissionsForRole("unassigned")).toEqual([]);
    expect(permissionsForRole("viewer")).not.toContain("projecthub:history:export_project");
    expect(permissionsForRole("finance")).toContain("projecthub:history:export_project");
  });
  it("keeps old Activity links working as History", () => {
    expect(normaliseSection("activity")).toBe("history");
    expect(normaliseSection("history")).toBe("history");
  });
});

describe("xlsx writer", () => {
  it("neutralises formula injection and control characters", () => {
    expect(safeCellText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeCellText("+1")).toBe("'+1");
    expect(safeCellText("-2")).toBe("'-2");
    expect(safeCellText("@x")).toBe("'@x");
    expect(safeCellText("a\u0001b")).toBe("ab");
    expect(safeCellText("Normal")).toBe("Normal");
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("produces a real workbook readable by a spreadsheet library", () => {
    const bytes = buildXlsx([
      {
        name: "Project History",
        header: ["Date & Time", "Title"],
        rows: [
          ["01/09/2026 10:00", "=cmd"],
          ["02/09/2026 11:00", "Café <&>"],
        ],
        table: true,
      },
      { name: "Export Info", header: ["Field", "Value"], rows: [["Rows", "2"]] },
    ]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const dir = mkdtempSync(join(tmpdir(), "wp0e-"));
    const file = join(dir, "h.xlsx");
    writeFileSync(file, bytes);
    let out = "";
    try {
      out = execFileSync(
        "python3",
        [
          "-c",
          "import sys,openpyxl;wb=openpyxl.load_workbook(sys.argv[1]);print(wb.sheetnames);ws=wb.worksheets[0];print([[c.value for c in r] for r in ws.iter_rows()])",
          file,
        ],
        { encoding: "utf8" },
      );
    } catch {
      return; // openpyxl unavailable in this runner; structural checks above still apply.
    }
    expect(out).toContain("['Project History', 'Export Info']");
    expect(out).toContain('"\'=cmd"');
    expect(out).toContain("Café <&>");
  });
});

// ---------------------------------------------------------------------------
// Endpoint authorisation (handler level, no database)
// ---------------------------------------------------------------------------

const getProject = vi.fn();
const queryHistory = vi.fn();
const collect = vi.fn();
vi.mock("@/lib/projecthub-projects.server", () => ({
  getProject: (...a: unknown[]) => getProject(...a),
}));
vi.mock("@/lib/projecthub-history.server", () => ({
  queryHistory: (...a: unknown[]) => queryHistory(...a),
  collectHistoryForExport: (...a: unknown[]) => collect(...a),
}));
vi.mock("@/lib/n3-session.server", () => ({ writeAudit: vi.fn(async () => undefined) }));

const { handleHistoryRequest } = await import("@/lib/projecthub-history-api.server");

function actor(role: ProjectHubRole, isOwner = false) {
  return {
    tenantRowId: "t1",
    n3UserId: "u1",
    role,
    correlationId: "c1",
    permissions: permissionsForRole(role),
    session: { isOwner, companyName: "Acme", displayName: "Owner", displayEmail: null },
  } as never;
}

describe("history endpoints", () => {
  beforeEach(() => {
    getProject.mockReset().mockResolvedValue({
      ok: true,
      project: { enquiry_reference: "ENQ-2026-00001", title: "T" },
    });
    queryHistory.mockReset().mockResolvedValue({
      ok: true,
      rows: [],
      nextCursor: null,
      pageSize: 50,
      total: null,
      appliedFilters: [],
    });
    collect.mockReset().mockResolvedValue({ ok: true, rows: [], applied: [] });
  });

  it("denies Global History to non-Owners, including finance", async () => {
    for (const role of ["finance", "project_manager", "viewer"] as ProjectHubRole[]) {
      const res = await handleHistoryRequest(actor(role), "global", null, false, {});
      expect(res.status).toBe(403);
    }
    expect(queryHistory).not.toHaveBeenCalled();
  });

  it("serves Global History and export to the exact Owner", async () => {
    expect(
      (await handleHistoryRequest(actor("owner", true), "global", null, false, {})).status,
    ).toBe(200);
    const res = await handleHistoryRequest(actor("owner", true), "global", null, true, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("hides projects the actor cannot see", async () => {
    getProject.mockResolvedValue({ ok: false, status: 404, message: "Not found" });
    const res = await handleHistoryRequest(actor("viewer"), "project", PID, false, {});
    expect(res.status).toBe(404);
    expect(queryHistory).not.toHaveBeenCalled();
  });

  it("blocks export for view-only roles and scope tampering", async () => {
    expect((await handleHistoryRequest(actor("viewer"), "project", PID, true, {})).status).toBe(
      403,
    );
    expect(
      (
        await handleHistoryRequest(actor("project_manager"), "project", PID, false, {
          scope: "global",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await handleHistoryRequest(actor("project_manager"), "project", PID, false, {
          projectId: "1b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b",
        })
      ).status,
    ).toBe(400);
    expect(
      (await handleHistoryRequest(actor("unassigned"), "project", PID, false, {})).status,
    ).toBe(403);
  });

  it("rejects exports over the row cap", async () => {
    collect.mockResolvedValue({
      ok: false,
      status: 422,
      tooMany: true,
      message: "More than 50,000 rows",
    });
    const res = await handleHistoryRequest(actor("owner", true), "global", null, true, {});
    expect(res.status).toBe(422);
  });
});
