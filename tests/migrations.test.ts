import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n")
  .toLowerCase();

const TABLES = [
  "projecthub_tenants",
  "projecthub_user_roles",
  "projecthub_integration_audit_events",
  "projecthub_n3_request_diagnostics",
];

describe("15. database migrations (static SQL source checks — no database connection)", () => {
  it("create all four starter tables", () => {
    for (const t of TABLES) expect(sql).toContain(`create table public.${t}`);
  });

  it("enable RLS on every table", () => {
    for (const t of TABLES) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });

  it("expose no browser policies and no browser grants", () => {
    expect(sql).not.toContain("create policy");
    expect(sql).not.toMatch(/grant[^;]*to\s+anon/);
    expect(sql).not.toMatch(/grant[^;]*to\s+authenticated/);
    for (const t of TABLES) {
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated`);
    }
  });

  it("enforce tenant uniqueness and tenant-scoped user identity", () => {
    expect(sql).toContain("unique (n3_tenant_id)");
    expect(sql).toContain("unique (tenant_id, n3_user_id)");
  });

  it("enforce immutable identities and append-only records", () => {
    expect(sql).toContain("n3_tenant_id is immutable");
    expect(sql).toContain("n3_user_id is immutable");
    expect(sql).toContain("before update or delete on public.projecthub_integration_audit_events");
    expect(sql).toContain("before update or delete on public.projecthub_n3_request_diagnostics");
  });

  it("uses no SECURITY DEFINER functions", () => {
    expect(sql).not.toContain("security definer");
  });
});
