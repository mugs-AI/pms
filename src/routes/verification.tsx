import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/n3-session";
import { n3Get, unwrapPageList } from "@/lib/n3-client";
import { buildODataFilter, DATASETS, type Dataset } from "@/lib/n3-datasets";

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
  const { isOwner, companyName, tenantCode, email, status } = useSession();
  const [activeId, setActiveId] = useState(DATASETS[0]!.id);
  const dataset = DATASETS.find((d) => d.id === activeId)!;

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
          Verification is limited to N3 account owners. Access is decided from the live{" "}
          <code>CompanyProfile/BasicInfo</code> response for your N3 session, and every underlying
          read is authorised again by N3 for your token — hiding the menu is not the only control.
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
          Data below was returned by N3 for <strong>{companyName ?? "—"}</strong> (tenant{" "}
          <code>{tenantCode ?? "—"}</code>) as <strong>{email ?? "—"}</strong>.
        </p>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="N3 master data"
          className="flex w-max min-w-full gap-2 sm:w-auto sm:flex-wrap"
        >
          {DATASETS.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === activeId}
              onClick={() => setActiveId(d.id)}
              className={`min-h-11 shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                d.id === activeId
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <DatasetPanel key={dataset.id} dataset={dataset} />
    </div>
  );
}

function DatasetPanel({ dataset }: { dataset: Dataset }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["n3", dataset.id, term, page],
    queryFn: async () => {
      if (dataset.mode === "all") {
        const data = await n3Get<unknown>(dataset.path);
        const rows = Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : unwrapPageList<Record<string, unknown>>(data).rows;
        return { rows, total: rows.length, clientSide: true };
      }
      const data = await n3Get<unknown>(dataset.path, {
        $top: PAGE_SIZE,
        $skip: page * PAGE_SIZE,
        $filter: buildODataFilter(dataset.searchFields, term),
      });
      const { rows, total } = unwrapPageList<Record<string, unknown>>(data);
      return { rows, total, clientSide: false };
    },
  });

  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    if (!query.data?.clientSide) return all;
    const q = term.trim().toLowerCase();
    const filtered = q
      ? all.filter((r) =>
          dataset.searchFields.some((f) =>
            String(r[f] ?? "")
              .toLowerCase()
              .includes(q),
          ),
        )
      : all;
    return filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  }, [query.data, term, page, dataset.searchFields]);

  const total = query.data?.clientSide
    ? (() => {
        const all = query.data?.rows ?? [];
        const q = term.trim().toLowerCase();
        return q
          ? all.filter((r) =>
              dataset.searchFields.some((f) =>
                String(r[f] ?? "")
                  .toLowerCase()
                  .includes(q),
              ),
            ).length
          : all.length;
      })()
    : (query.data?.total ?? 0);

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 sm:min-w-56 sm:flex-1">
          <label
            htmlFor={`search-${dataset.id}`}
            className="block text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          >
            Search code or name
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id={`search-${dataset.id}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(0);
                  setTerm(search);
                }
              }}
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={dataset.searchFields.join(", ")}
            />
            <button
              type="button"
              onClick={() => {
                setPage(0);
                setTerm(search);
              }}
              className="min-h-11 shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
          </div>
        </div>
        <p className="text-xs break-words text-muted-foreground">
          <span className="font-medium text-foreground">{dataset.scope}</span> ·{" "}
          <code>GET /{dataset.path}</code> ·{" "}
          {dataset.mode === "page" ? "OData $top/$skip/$filter" : "full list"}
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
            No records returned by N3 for this query.
          </p>
        ) : (
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <caption className="sr-only">{dataset.label} records returned by N3</caption>
            <thead>
              <tr className="bg-secondary text-left">
                {dataset.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold tracking-wide text-secondary-foreground uppercase"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={String(row[dataset.idKey] ?? i)} className="border-t border-border">
                  {dataset.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2 text-foreground ${c.mono ? "font-mono text-xs text-muted-foreground" : ""}`}
                    >
                      {formatCell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border p-4 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {total} record{total === 1 ? "" : "s"} · page {page + 1} of {maxPage + 1}
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
            disabled={page >= maxPage}
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

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
