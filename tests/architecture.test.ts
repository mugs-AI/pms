import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import {
  edgesOf,
  findGeneratedAuthReach,
  GENERATED_AUTH_FILES,
  type FileMap,
} from "./support/module-graph";
import { typesContract } from "./support/types-contract";

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(join(root, "src"));
const rel = (f: string) => relative(root, f).split(sep).join("/");

/**
 * Controlled platform-file exception (docs/governance/PLATFORM_MANAGED_FILES.md):
 * exactly these three generated auth files may exist but must be unreachable.
 * They are excluded from the browser token scan ONLY because the resolved
 * module-graph guard below proves no application module can load them.
 */
const GENERATED = new Set<string>(GENERATED_AUTH_FILES);

/**
 * Every browser-reachable source file under src. Server-only modules are
 * excluded by filename, the generated types file is skipped, and the three
 * exact platform-managed auth paths are skipped (covered by the graph guard).
 */
const browserFiles = sourceFiles.filter(
  (f) =>
    /\.(ts|tsx)$/.test(f) &&
    !f.endsWith(".server.ts") &&
    !f.endsWith(".server.tsx") &&
    !f.endsWith(join("integrations", "supabase", "types.ts")) &&
    !GENERATED.has(rel(f)),
);

const PROHIBITED_BROWSER_TOKENS = [
  "supabase.auth",
  "VITE_SUPABASE",
  "@supabase/supabase-js",
  "persistSession",
  "autoRefreshToken",
  "attachSupabaseAuth",
  "client.server",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function realFileMap(): FileMap {
  const map: FileMap = new Map();
  for (const f of sourceFiles)
    if (/\.(ts|tsx|js|jsx)$/.test(f)) map.set(rel(f), readFileSync(f, "utf8"));
  return map;
}

const APP_ENTRIES = (files: FileMap) =>
  [...files.keys()].filter(
    (f) =>
      f.startsWith("src/routes/") ||
      ["src/router.tsx", "src/server.ts", "src/start.ts", "src/routeTree.gen.ts"].includes(f),
  );

describe("controlled platform-managed auth files", () => {
  it("allows only the documented four platform files beside client.server.ts", () => {
    const dir = join(root, "src/integrations/supabase");
    const allowed = new Set([
      "client.server.ts",
      "types.ts",
      "auth-middleware.ts",
      "client.ts",
      "previewAuthStorage.ts",
    ]);
    for (const f of readdirSync(dir)) expect(allowed.has(f), `${f} is not allowed`).toBe(true);
    expect(readdirSync(dir)).toContain("client.server.ts");
    expect(readdirSync(dir)).toContain("types.ts");
    // auth-attacher would wire Supabase auth into server-function calls.
    expect(existsSync(join(dir, "auth-attacher.ts"))).toBe(false);
  });

  it("no application module reaches a generated auth file (resolved graph)", () => {
    const files = realFileMap();
    const entries = APP_ENTRIES(files);
    expect(entries.length).toBeGreaterThan(10);
    const fromEntries = findGeneratedAuthReach(files, entries);
    expect(fromEntries.violations).toEqual([]);
    expect(fromEntries.problems).toEqual([]);
    // Stronger: every non-generated source file is treated as an entry.
    const all = [...files.keys()].filter((f) => !GENERATED.has(f));
    const everywhere = findGeneratedAuthReach(files, all);
    expect(everywhere.violations).toEqual([]);
    expect(everywhere.problems).toEqual([]);
    // The graph really is walked: server-only Supabase access is reachable.
    expect(fromEntries.visited.has("src/integrations/supabase/client.server.ts")).toBe(true);
  });

  it("catches direct, re-export, indirect, dynamic and glob use (negative cases)", () => {
    const base: [string, string][] = [
      ["src/integrations/supabase/client.ts", 'import "./previewAuthStorage";'],
      ["src/integrations/supabase/previewAuthStorage.ts", "export const x = 1;"],
      ["src/integrations/supabase/auth-middleware.ts", 'import "./client";'],
      ["src/lib/safe.ts", "export const ok = 1;"],
    ];
    const run = (extra: [string, string][], entry = "src/routes/a.tsx") =>
      findGeneratedAuthReach(new Map([...base, ...extra]), [entry]);

    // Clean app plus generated files importing each other: no violation.
    expect(run([["src/routes/a.tsx", 'import "@/lib/safe";']]).violations).toEqual([]);

    const direct = run([
      ["src/routes/a.tsx", 'import { supabase } from "@/integrations/supabase/client";'],
    ]);
    expect(direct.violations[0]?.chain).toEqual([
      "src/routes/a.tsx",
      "src/integrations/supabase/client.ts",
    ]);

    const reexport = run([
      ["src/routes/a.tsx", 'export * from "../integrations/supabase/auth-middleware";'],
    ]);
    expect(reexport.violations).toHaveLength(1);

    const indirect = run([
      ["src/routes/a.tsx", 'import "@/lib/mid";'],
      ["src/lib/mid.ts", 'export { supabase } from "@/integrations/supabase/client";'],
    ]);
    expect(indirect.violations[0]?.chain).toEqual([
      "src/routes/a.tsx",
      "src/lib/mid.ts",
      "src/integrations/supabase/client.ts",
    ]);

    const dynamic = run([
      ["src/routes/a.tsx", 'const m = () => import("@/integrations/supabase/previewAuthStorage");'],
    ]);
    expect(dynamic.violations[0]?.kind).toBe("dynamic");

    const glob = run([
      ["src/routes/a.tsx", 'const m = import.meta.glob("/src/integrations/supabase/*.ts");'],
    ]);
    expect(glob.violations.map((v) => v.kind)).toContain("glob");

    const opaque = run([["src/routes/a.tsx", "const n = 'x'; const m = () => import(n);"]]);
    expect(opaque.problems).toHaveLength(1);

    // Type-only imports are erased and do not execute.
    const typeOnly = run([
      ["src/routes/a.tsx", 'import type { Database } from "@/integrations/supabase/client";'],
    ]);
    expect(typeOnly.violations).toEqual([]);

    // Sanity: the edge extractor sees every import form.
    const edges = edgesOf(
      new Map([
        ["src/a.ts", 'import "./b"; export * from "./c"; import("./d");'],
        ["src/b.ts", ""],
        ["src/c.ts", ""],
        ["src/d.ts", ""],
      ]),
      "src/a.ts",
    ).edges.map((e) => e.to);
    expect(edges).toEqual(["src/b.ts", "src/c.ts", "src/d.ts"]);
  });

  it.skipIf(!existsSync(join(root, "dist")))(
    "no generated auth module is present in the production build output",
    () => {
      const out = walk(join(root, "dist")).filter((f) => /\.(m?js|html)$/.test(f));
      const markers = [
        "lovable-preview-auth",
        "brokeredPreviewStorage",
        "Only Bearer tokens are supported",
        "Unauthorized: No authorization header provided",
      ];
      let controlSeen = false;
      for (const f of out) {
        const src = readFileSync(f, "utf8");
        for (const m of markers) expect(src.includes(m), `${rel(f)} contains ${m}`).toBe(false);
        if (src.includes("Connect Supabase in Lovable Cloud")) controlSeen = true;
      }
      // Positive control: the allowed server-only client IS in the build, so the scan works.
      expect(controlSeen).toBe(true);
    },
  );

  it("matches the approved structural types contract from 7ac1a2d", () => {
    const fixture = JSON.parse(
      readFileSync(join(root, "tests/fixtures/supabase-types-contract.json"), "utf8"),
    ) as { structure: unknown };
    const current = typesContract(
      readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8"),
    );
    expect(current.structure).toEqual(fixture.structure);
  });

  it("pins the generator metadata to the documented PostgrestVersion 14.5", () => {
    // Metadata correction (see governance doc): approved 14.15 -> generator 14.5.
    // Any future change must be reviewed and this value updated deliberately.
    const current = typesContract(
      readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8"),
    );
    expect(current.postgrestVersion).toBe("14.5");
  });

  it("types contract tolerates formatting but fails on structural change", () => {
    const src = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");
    const baseline = typesContract(src).structure;
    expect(typesContract(src.replace(/\n\s+/g, "\n ")).structure).toEqual(baseline);
    const typeChange = src.replace(/(enquiry_reference: )string/, "$1number");
    expect(typesContract(typeChange).structure).not.toEqual(baseline);
    const nullChange = src.replace(/(cancellation_reason: )string \| null/, "$1string");
    expect(typesContract(nullChange).structure).not.toEqual(baseline);
    const optChange = src.replace(/(\n\s+)title\?: string/, "$1title: string");
    expect(typesContract(optChange).structure).not.toEqual(baseline);
    const relChange = src.replace(
      /referencedRelation: "projecthub_tenants"/,
      'referencedRelation: "x"',
    );
    expect(typesContract(relChange).structure).not.toEqual(baseline);
    const rpcChange = src.replace(/p_year: number/, "p_year: string");
    expect(typesContract(rpcChange).structure).not.toEqual(baseline);
    const enumChange = src.replace(/\| "viewer"/, "");
    expect(typesContract(enumChange).structure).not.toEqual(baseline);
  });

  it("keeps the generated database types at the approved baseline contract", () => {
    const types = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");
    for (const table of [
      "projecthub_tenants",
      "projecthub_user_roles",
      "projecthub_projects",
      "projecthub_project_phases",
      "projecthub_project_team_members",
      "projecthub_boq_versions",
      "projecthub_boq_sections",
      "projecthub_boq_items",
      "projecthub_project_events",
      "projecthub_integration_audit_events",
      "projecthub_n3_request_diagnostics",
      "projecthub_project_sequences",
    ]) {
      expect(types, `${table} must remain in the generated types`).toContain(table);
    }
    expect(types).toContain("projecthub_create_enquiry");
    expect(types).toContain("projecthub_clone_boq_version");
    for (const column of ["sequence_no", "project_reference_snapshot", "changed_fields"]) {
      expect(types, `WP0E history column ${column}`).toContain(column);
    }
  });

  it("adds no N3 mutation method or path anywhere in the source tree", () => {
    for (const file of sourceFiles.filter((f) => /\.(ts|tsx)$/.test(f))) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must not declare a non-GET N3 call`).not.toMatch(
        /n3(Post|Put|Patch|Delete)\s*\(/,
      );
    }
  });

  it("ignores local env files but allows .env.example", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });

  it("keeps .env.example to empty, non-secret, server-only placeholders", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).not.toContain("VITE_SUPABASE");
    for (const line of example.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Every assignment must be an empty placeholder.
      expect(trimmed, line).toMatch(/^[A-Z0-9_]+=$/);
    }
    // No real URL, JWT, key, tenant id or project id may appear.
    expect(example).not.toMatch(/https?:\/\//);
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}/);
    expect(example).not.toMatch(/sb_(publishable|secret)_/);
    expect(example).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("has no browser module referencing supabase auth, VITE_SUPABASE or a supabase client", () => {
    for (const file of browserFiles) {
      const src = readFileSync(file, "utf8");
      for (const token of PROHIBITED_BROWSER_TOKENS) {
        expect(src, `${file} must not contain ${token}`).not.toContain(token);
      }
    }
  });

  it("declares an explicit empty functionMiddleware list", () => {
    const start = readFileSync(join(root, "src/start.ts"), "utf8");
    expect(start).toMatch(/functionMiddleware:\s*\[\s*\]/);
    expect(start).not.toContain("attachSupabaseAuth");
  });

  it("keeps the service-role client server-only and fail-closed", () => {
    const client = readFileSync(join(root, "src/integrations/supabase/client.server.ts"), "utf8");
    expect(client).toContain('process.env["SUPABASE_URL"]');
    expect(client).toContain('process.env["SUPABASE_SERVICE_ROLE_KEY"]');
    expect(client).toContain("throw new Error(message)");
    // The key value itself is never logged.
    expect(client).not.toMatch(/console\.[a-z]+\([^)]*SERVICE_ROLE_KEY\s*\)/);
  });
});
