import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/n3-session";
import { MASTER_KINDS, MASTER_SPECS, type MasterKind } from "@/lib/n3-master-registry";
import { useN3MasterPage } from "@/lib/projecthub-hooks";

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "N3 Data Verification — ProjectHub" },
      {
        name: "description",
        content:
          "Owner-only read-only verification of N3 master data: projects, customers, suppliers, stocks, users, GL accounts, tax codes and terms.",
      },
      { property: "og:title", content: "N3 Data Verification — ProjectHub" },
      {
        property: "og:description",
        content: "Read-only proof that ProjectHub reads live, tenant-correct N3 data.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <VerificationPage />
    </AppShell>
  ),
});

const PAGE_SIZE = 25;

function VerificationPage() {
  const { isOwner, companyName, status } = useSession();
  const [activeId, setActiveId] = useState<MasterKind>(MASTER_KINDS[0]!);

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Checking your N3 session…</p>;
  }

  if (!isOwner) {
    return (
      <section className="rounded-lg border border-border bg-card p-6 shadow-card">
        <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
          Role unassigned
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Verification is limited to N3 account owners. Owner authority is decided only from the
          exact tenant-bound N3 token role <code>sys-admin</code>; live{" "}
          <code>CompanyProfile/BasicInfo</code> is used to validate the bearer and tenant code, not
          to grant Owner. Every underlying read is authorised again by the server for your token —
          hiding the menu is not the only control.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-wide text-foreground sm:text-3xl">
          N3 Data Verification
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only. Nothing on this page creates, updates, voids or posts an N3 record.
        </p>
        <p className="mt-2 text-sm text-foreground">
          Data below was returned by N3 for <strong>{companyName ?? "—"}</strong>.
        </p>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="N3 master data"
          className="flex w-max min-w-full gap-2 sm:w-auto sm:flex-wrap"
        >
          {MASTER_KINDS.map((kind) => (
            <button
              key={kind}
              role="tab"
              aria-selected={kind === activeId}
              onClick={() => setActiveId(kind)}
              className={`min-h-11 shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                kind === activeId
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {MASTER_SPECS[kind].label}
            </button>
          ))}
        </div>
      </div>

      <DatasetPanel key={activeId} kind={activeId} />
    </div>
  );
}

/**
 * One shared verification panel for all ten datasets.
 *
 * Every tab reads through the SAME server-owned registry and bounded search
 * (`GET /api/projecthub/master/:kind`) used by the business pickers. The
 * browser never builds an OData expression and never sees a raw N3 record.
 */
function DatasetPanel({ kind }: { kind: MasterKind }) {
  const spec = MASTER_SPECS[kind];
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);

  const query = useN3MasterPage(kind, term, page, PAGE_SIZE);
  const rows = query.data?.options ?? [];
  const total = query.data?.total ?? null;
  const hasMore = query.data?.hasMore === true;
  const incomplete = query.data?.completeness === "incomplete";
  const maxPage = total !== null ? Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) : null;

  const runSearch = () => {
    setPage(0);
    setTerm(search);
  };

  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:min-w-56 sm:flex-1">
          <label
            htmlFor={`search-${kind}`}
            className="block text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          >
            Search code or name
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id={`search-${kind}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={spec.searchHint}
            />
            <button
              type="button"
              onClick={runSearch}
              className="min-h-11 shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
            <button
              type="button"
              disabled={search === "" && term === "" && page === 0}
              onClick={() => {
                setSearch("");
                setTerm("");
                setPage(0);
              }}
              className="min-h-11 shrink-0 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="text-xs break-words text-muted-foreground">
          <span className="font-medium text-foreground">{spec.scope}</span> ·{" "}
          <code>GET /api/projecthub/master/{kind}</code> · shared server adapter ·{" "}
          {spec.mode === "page" ? "bounded paged scan" : "full list"}
        </p>
      </div>

      <div className="overflow-x-auto">
        {query.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Loading from N3…</p>
        ) : query.isError ? (
          <p role="alert" className="p-6 text-sm text-destructive">
            {(query.error as Error).message}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {incomplete
              ? "Search incomplete — N3 did not return a complete searchable set. Refine the search or retry."
              : "No matching N3 records."}
          </p>
        ) : (
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">{spec.label} records returned by N3</caption>
            <thead>
              <tr className="bg-secondary text-left">
                {["Code", "Name", "Detail", "N3 id"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold tracking-wide text-secondary-foreground uppercase"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{row.code ?? "—"}</td>
                  <td className="px-4 py-2 text-foreground">{row.name ?? "—"}</td>
                  <td className="px-4 py-2 text-foreground">{row.detail ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-4 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {total !== null
            ? `${total} record${total === 1 ? "" : "s"} · page ${page + 1} of ${(maxPage ?? 0) + 1}`
            : `Page ${page + 1} · total unknown`}
          {incomplete
            ? " · Search incomplete — N3 did not return a complete searchable set. Refine the search or retry."
            : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-input px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!hasMore && (maxPage === null || page >= maxPage)}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-input px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
