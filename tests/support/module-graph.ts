/**
 * Resolved module-graph analysis for the platform-managed file exception
 * (docs/governance/PLATFORM_MANAGED_FILES.md). Works over any virtual file map
 * so negative cases can be proven without touching the real tree.
 */
import ts from "typescript";

export const GENERATED_AUTH_FILES = [
  "src/integrations/supabase/auth-middleware.ts",
  "src/integrations/supabase/client.ts",
  "src/integrations/supabase/previewAuthStorage.ts",
] as const;

export type FileMap = Map<string, string>; // posix path relative to repo root -> source

export type Edge = { from: string; to: string; kind: "static" | "dynamic" | "glob" };
export type GraphProblem = { file: string; message: string };

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** Resolves an import specifier to a file in the map, or null for packages. */
export function resolveSpecifier(files: FileMap, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) base = `${dirname(from)}/${spec}`;
  else if (spec.startsWith("/src/")) base = spec.slice(1);
  else return null;
  base = normalise(base.replace(/\?.*$/, ""));
  if (files.has(base)) return base;
  for (const ext of EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return `${base}.ts`; // unresolved local target still recorded so it is never silently ignored
}

function globToRegExp(pattern: string): RegExp {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, "(?:.*/)?");
  return new RegExp(`^${esc}$`);
}

/** Static, re-export, literal dynamic and import.meta.glob edges for one file. */
export function edgesOf(files: FileMap, file: string): { edges: Edge[]; problems: GraphProblem[] } {
  const src = files.get(file) ?? "";
  const edges: Edge[] = [];
  const problems: GraphProblem[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const add = (spec: string, kind: Edge["kind"]) => {
    const to = resolveSpecifier(files, file, spec);
    if (to) edges.push({ from: file, to, kind });
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // Type-only imports are erased and never execute.
      const typeOnly =
        (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && node.isTypeOnly);
      if (!typeOnly) add(node.moduleSpecifier.text, "static");
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression))
        add(ref.expression.text, "static");
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const arg = node.arguments[0];
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      const isGlob =
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "glob" &&
        callee.expression.getText(sf) === "import.meta";
      if (isDynamicImport || isRequire) {
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)))
          add(arg.text, "dynamic");
        else
          problems.push({
            file,
            message: `non-literal ${isRequire ? "require" : "dynamic import"} cannot be proven safe`,
          });
      } else if (isGlob && arg) {
        const patterns = ts.isArrayLiteralExpression(arg) ? [...arg.elements] : [arg];
        for (const p of patterns) {
          if (!ts.isStringLiteral(p) && !ts.isNoSubstitutionTemplateLiteral(p)) {
            problems.push({ file, message: "non-literal import.meta.glob pattern" });
            continue;
          }
          const raw = p.text;
          const abs = raw.startsWith("/")
            ? normalise(raw.slice(1))
            : raw.startsWith("@/")
              ? normalise(`src/${raw.slice(2)}`)
              : normalise(`${dirname(file)}/${raw}`);
          const re = globToRegExp(abs);
          for (const candidate of files.keys())
            if (re.test(candidate)) edges.push({ from: file, to: candidate, kind: "glob" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { edges, problems };
}

/**
 * Walks the application graph from the given entries. Edges that START inside
 * a generated file are not followed: imports between the generated files do
 * not make them application dependencies. Any application file whose edge
 * lands on a generated auth file is a violation, with the path that reached it.
 */
export function findGeneratedAuthReach(
  files: FileMap,
  entries: string[],
  generated: readonly string[] = GENERATED_AUTH_FILES,
): {
  violations: { chain: string[]; kind: Edge["kind"] }[];
  problems: GraphProblem[];
  visited: Set<string>;
} {
  const gen = new Set(generated);
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  const violations: { chain: string[]; kind: Edge["kind"] }[] = [];
  const problems: GraphProblem[] = [];
  for (const e of entries) {
    if (gen.has(e)) {
      violations.push({ chain: [e], kind: "static" });
      continue;
    }
    if (!parent.has(e)) {
      parent.set(e, null);
      queue.push(e);
    }
  }
  const chainTo = (f: string) => {
    const out = [f];
    let p = parent.get(f);
    while (p) {
      out.unshift(p);
      p = parent.get(p);
    }
    return out;
  };
  while (queue.length) {
    const file = queue.shift() as string;
    if (!files.has(file)) continue;
    const { edges, problems: p } = edgesOf(files, file);
    problems.push(...p);
    for (const edge of edges) {
      if (gen.has(edge.to)) {
        violations.push({ chain: [...chainTo(file), edge.to], kind: edge.kind });
        continue;
      }
      if (!parent.has(edge.to)) {
        parent.set(edge.to, file);
        queue.push(edge.to);
      }
    }
  }
  return { violations, problems, visited: new Set(parent.keys()) };
}

/** Loads the real src tree and returns graph violations from every non-generated file. */
export async function generatedAuthReachInRepo(root = process.cwd()) {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, relative, sep } = await import("node:path");
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const f = join(d, e);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
  const files: FileMap = new Map();
  for (const f of walk(join(root, "src")))
    if (/\.(ts|tsx|js|jsx)$/.test(f))
      files.set(relative(root, f).split(sep).join("/"), readFileSync(f, "utf8"));
  const gen = new Set<string>(GENERATED_AUTH_FILES);
  return findGeneratedAuthReach(
    files,
    [...files.keys()].filter((f) => !gen.has(f)),
  );
}
