# Controlled exception: platform-managed Supabase integration files

Status: approved by owner (WP0E controlled platform-file exception), input SHA `ba45b2a71c8ef2d506e59bfb0d3040a55a472b42`.
This does **not** authorise Supabase authentication in ProjectHub. Authentication stays N3-only; database access stays server-only via `client.server.ts`.

## Regeneration evidence

- Generator: Lovable Cloud's managed integration sync (`gpt-engineer-app[bot]`).
- Trigger: start of each new Lovable agent session. It produces a "Work in progress" commit within about a minute of the session opening. Fourteen such commits exist since 2026-08-17. Examples: `1fdde78` (2026-09-30 12:10 UTC), `829b679` (2026-10-01 00:11 UTC).
- Each commit restores exactly the four files below, applied on top of a clean tree (for example `70d1e42` → `829b679`).
- Manual deletion is undone at the next session, so files are no longer deleted or restored.
- No project setting disables the sync while Lovable Cloud is connected. Disconnecting is out of scope.

## Exact allowed paths (no others)

- `src/integrations/supabase/auth-middleware.ts`: generated, must be unreachable.
- `src/integrations/supabase/client.ts`: generated, must be unreachable.
- `src/integrations/supabase/previewAuthStorage.ts`: generated, must be unreachable.
- `src/integrations/supabase/types.ts`: generated, governed by a structural contract.

`client.server.ts` remains project-owned and protected. `auth-attacher.ts` remains forbidden.

## Replacement checks (`tests/architecture.test.ts`, `tests/support/*`)

1. **Directory allowlist.** Only the four files above plus `client.server.ts` may exist, and `auth-attacher.ts` must be absent.
2. **Resolved module graph.** The TypeScript AST resolves the `@/` alias and relative paths. It covers static imports, re-exports, `import x = require`, literal dynamic `import()`/`require` and `import.meta.glob`.
   - Two walks run: one from the application entries (routes, router, server, start, route tree) and one from every non-generated source file.
   - Neither walk may reach a generated auth file.
   - Edges that start inside generated files are not followed, so their imports of each other do not make them application dependencies.
   - A non-literal dynamic import or glob fails as unprovable.
   - Type-only imports are erased and allowed.
   - Negative cases prove direct, re-export, indirect, dynamic, glob and opaque use are all caught.
3. **Production build.** When `dist/` exists after `vite build`, its JavaScript/HTML is scanned for markers unique to the generated files. None may appear. A positive control (the `client.server.ts` marker) proves the scan reads the real server bundle.
4. **Browser token scan.** This scan is unchanged for all product code. Only the three exact generated paths are excluded, because check 2 covers them.
5. **Unchanged checks.** `functionMiddleware: []`, the service-role fail-closed check, the N3 tenant/Owner tests and the no-N3-mutation guard all stay as they were.

## types.ts: structural contract

- The `Database` and `Json` types are serialised into a formatting-independent tree. It covers tables, columns, types, optionality, nullability unions, relationships, views, RPC args/returns, enums and composite types.
- `tests/fixtures/supabase-types-contract.json` is derived from `7ac1a2d:src/integrations/supabase/types.ts`.
- Formatting may differ. Any structural change fails, and negative tests prove this.

### Metadata correction: PostgrestVersion

- Approved file: `"14.15"`. Platform generator against the connected backend: `"14.5"`. The structure is otherwise identical.
- Read-only evidence: the backend's REST gateway identifies itself as PostgREST (`proxy-status: PostgREST`) but does not publish a version to unauthenticated callers. The generator output is the only available source, and it consistently reports `14.5`. This is recorded as reported by the generator; the version is not independently verified.
- The test pins exactly `"14.5"`. Any future change fails and requires review. No migration was run.

## Lint / format

ESLint and Prettier ignore exactly the four generated paths. No product file is excluded.

## Release conditions

A release is blocked if any of these happen:

- another file appears in the integration directory;
- the graph guard or build-output scan finds a reachable generated auth module;
- the structural contract or the PostgrestVersion pin changes without owner approval;
- `functionMiddleware` stops being `[]`.

This exception is withdrawn if Lovable support disables the sync. The files would then be removed and the earlier absence checks restored.
