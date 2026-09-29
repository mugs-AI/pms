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
