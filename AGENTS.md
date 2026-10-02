<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- History: all ProjectHub business events go through `writeHistoryEvent` (projecthub-history.server.ts) into the append-only `projecthub_project_events`; reads/exports share one allowlisted parser — why: one tenant-scoped, auditable ledger.
- XLSX exports use the dependency-free `xlsx-writer.server.ts` (all cells text, formula-prefix neutralised) — why: no package changes and no formula injection.
- Platform-managed Supabase files (`auth-middleware.ts`, `client.ts`, `previewAuthStorage.ts`, `types.ts`) are a controlled exception: allowed to exist, proven unreachable by the resolved module-graph and build-output guards, types governed by a structural contract — see docs/governance/PLATFORM_MANAGED_FILES.md — why: Lovable Cloud regenerates them every session; ProjectHub auth stays N3-only.
