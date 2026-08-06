import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  AccessState,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeading,
  Skeleton,
  inputClass,
} from "@/components/projecthub/ui";
import { useSession } from "@/lib/n3-session";
import { useProjects, type ProjectRow } from "@/lib/projecthub-hooks";
import { PROJECT_STATUS_LABELS, statusTone } from "@/components/projecthub/status";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Construction and renovation project register: enquiries, awarded projects, customer links and N3 project codes.",
      },
      { property: "og:title", content: "Projects — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Search, filter and open construction project enquiries tracked in ProjectHub.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <ProjectsPage />
    </AppShell>
  ),
});

function ProjectsPage() {
  const { hasPermission } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [projectType, setProjectType] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const canList = hasPermission("projecthub:projects:list");
  const canCreate = hasPermission("projecthub:projects:create");
  const query = useProjects({ search, status, projectType, page, pageSize }, canList);

  if (!canList) return <AccessState />;

  const total = query.data?.total ?? 0;
  const rows = query.data?.rows ?? [];
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Projects"
        subtitle="Every project starts as an enquiry. The server decides whether you see all projects or only your assignments."
        actions={
          canCreate ? (
            <Link
              to="/projects/new"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              New Enquiry
            </Link>
          ) : null
        }
      />

      <Card className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Search
          </span>
          <input
            type="search"
            className={`${inputClass} mt-1`}
            placeholder="Reference, title or customer"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Status
          </span>
          <select
            className={`${inputClass} mt-1`}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Project type
          </span>
          <select
            className={`${inputClass} mt-1`}
            value={projectType}
            onChange={(event) => {
              setProjectType(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All types</option>
            <option value="construction">Construction</option>
            <option value="renovation">Renovation</option>
          </select>
        </label>
      </Card>

      {query.isLoading ? <Skeleton rows={6} /> : null}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}

      {query.data && rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Create the first enquiry to start tracking a construction or renovation project."
          action={
            canCreate ? (
              <Link
                to="/projects/new"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                New Enquiry
              </Link>
            ) : null
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="grid gap-3">
          {rows.map((row) => (
            <ProjectCard key={row.id} row={row} />
          ))}
        </div>
      ) : null}

      {total > pageSize ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {lastPage + 1} · {total} projects
          </span>
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
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-input px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProjectCard({ row }: { row: ProjectRow }) {
  const customer = row.n3_customer_name ?? row.requested_customer_name ?? "No customer recorded";
  const code = row.primary_project_code ?? "No N3 project code";
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: row.id }}
      className="block rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-accent"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {row.enquiry_reference}
          </p>
          <p className="truncate text-lg font-semibold text-foreground">{row.title}</p>
          <p className="truncate text-sm text-muted-foreground">{customer}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(row.status)}>
            {PROJECT_STATUS_LABELS[row.status] ?? row.status}
          </Badge>
          <Badge>{row.budget_mode === "simple_budget" ? "Simple budget" : "Detailed BOQ"}</Badge>
          <Badge tone="accent">{code}</Badge>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="font-semibold uppercase">Enquiry date</dt>
          <dd>{row.enquiry_date ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase">Type</dt>
          <dd className="capitalize">{row.project_type}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase">Updated</dt>
          <dd>{new Date(row.updated_at).toLocaleString()}</dd>
        </div>
      </dl>
    </Link>
  );
}
