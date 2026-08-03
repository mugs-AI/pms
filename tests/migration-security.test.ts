import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Collapses whitespace so statements can be matched exactly, not by comment text. */
function normalise(sql: string) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const ORIGINAL = "20260801051555_2e67bf5d-5f88-4ecc-b898-5dba2a8cd942.sql";
const corrective = files.filter((f) => f > ORIGINAL);
const correctiveSql = normalise(
  corrective.map((f) => readFileSync(join(dir, f), "utf8")).join("\n"),
);
const allSql = normalise(files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n"));

const TABLES = [
  "projecthub_tenants",
  "projecthub_user_roles",
  "projecthub_integration_audit_events",
  "projecthub_n3_request_diagnostics",
];

describe("16. corrective migration privileges (static SQL-source checks — no database connection)", () => {
  it("adds a corrective migration ordered after the original migration", () => {
    expect(files).toContain(ORIGINAL);
    expect(corrective.length).toBeGreaterThan(0);
  });

  it("revokes all service_role privileges on every table before re-granting", () => {
    for (const t of TABLES) {
      const revoke = `revoke all privileges on table public.${t} from service_role;`;
      expect(correctiveSql).toContain(revoke);
      const grant = correctiveSql.indexOf(`on table public.${t} to service_role`);
      expect(grant).toBeGreaterThan(correctiveSql.indexOf(revoke));
    }
  });

  it("grants tenants and user roles only select, insert and update", () => {
    for (const t of ["projecthub_tenants", "projecthub_user_roles"]) {
      expect(correctiveSql).toContain(
        `grant select, insert, update on table public.${t} to service_role;`,
      );
    }
  });

  it("grants audit and diagnostics only select and insert", () => {
    for (const t of ["projecthub_integration_audit_events", "projecthub_n3_request_diagnostics"]) {
      expect(correctiveSql).toContain(`grant select, insert on table public.${t} to service_role;`);
    }
  });

  it("never grants delete, truncate, references or trigger to service_role", () => {
    const grants = allSql.match(/grant[^;]*to service_role/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      for (const privilege of ["delete", "truncate", "references", "trigger", "all"]) {
        expect(grant, grant).not.toContain(privilege);
      }
    }
  });

  it("blocks truncate on both append-only tables", () => {
    expect(correctiveSql).toContain(
      "create trigger projecthub_audit_block_truncate before truncate on public.projecthub_integration_audit_events for each statement execute function public.projecthub_block_write();",
    );
    expect(correctiveSql).toContain(
      "create trigger projecthub_diag_block_truncate before truncate on public.projecthub_n3_request_diagnostics for each statement execute function public.projecthub_block_write();",
    );
  });

  it("keeps the existing update/delete append-only triggers", () => {
    expect(allSql).toContain(
      "before update or delete on public.projecthub_integration_audit_events",
    );
    expect(allSql).toContain("before update or delete on public.projecthub_n3_request_diagnostics");
  });

  it("uses no security definer anywhere in the ProjectHub migrations", () => {
    expect(allSql).not.toContain("security definer");
  });

  it("grants nothing to anon or authenticated and creates no policy", () => {
    expect(allSql).not.toMatch(/grant[^;]*to\s+(anon|authenticated)/);
    expect(allSql).not.toContain("create policy");
  });

  it("keeps row level security enabled on all four tables", () => {
    for (const t of TABLES) {
      expect(allSql).toContain(`alter table public.${t} enable row level security;`);
    }
  });
});
