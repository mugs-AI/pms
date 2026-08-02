import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(join(root, "src"));
const browserFiles = sourceFiles.filter(
  (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".server.ts") && !f.includes("integrations/supabase"),
);

describe("architecture guards", () => {
  it("has no committed .env and no browser Supabase auth files", () => {
    for (const f of [
      ".env",
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/auth-attacher.ts",
      "src/integrations/supabase/auth-middleware.ts",
    ]) {
      expect(existsSync(join(root, f)), `${f} must not exist`).toBe(false);
    }
  });

  it("ignores local env files but allows .env.example", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });

  it("has no browser module referencing supabase auth, VITE_SUPABASE or a supabase client", () => {
    for (const file of browserFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toContain("supabase.auth");
      expect(src, file).not.toContain("VITE_SUPABASE");
      expect(src, file).not.toContain("@supabase/supabase-js");
      expect(src, file).not.toContain("persistSession");
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
