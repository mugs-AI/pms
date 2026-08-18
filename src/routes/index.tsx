import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  AccessState,
  Badge,
  Card as PanelCard,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/projecthub/ui";
import { PROJECT_STATUS_LABELS, statusTone } from "@/components/projecthub/status";
import { useSession } from "@/lib/n3-session";
import { useDashboard } from "@/lib/projecthub-hooks";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — N3 ProjectHub" },
      {
        name: "description",
        content:
          "ProjectHub portfolio dashboard: enquiry and project counts plus recently updated construction and renovation projects.",
      },
      { property: "og:title", content: "Dashboard — N3 ProjectHub" },
      {
        property: "og:description",
        content:
          "ProjectHub portfolio dashboard: enquiry and project counts plus recently updated construction and renovation projects.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <AppShell>
      <DashboardBody />
    </AppShell>
  );
}

function DashboardBody() {
  const { hasPermission, roleStatus } = useSession();
  const canList = hasPermission("projecthub:projects:list");
  const query = useDashboard(canList);
  const dashboard = query.data?.dashboard;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live ProjectHub portfolio for your N3 company, scoped to what your ProjectHub role is
          allowed to see.
        </p>
      </section>

      {!canList ? (
        roleStatus === "owner" || roleStatus === "assigned" ? (
          <EmptyState
            title="No project access"
            body="Your ProjectHub role does not include the project register."
          />
        ) : (
          <AccessState />
        )
      ) : query.isLoading ? (
        <Skeleton rows={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !dashboard ? (
        <EmptyState title="No portfolio data" body="Nothing is visible to you yet." />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total projects" value={dashboard.total} />
            <Kpi label="Enquiries" value={dashboard.enquiries} />
            <Kpi label="Active projects" value={dashboard.active} />
            <Kpi label="Cancelled / lost" value={dashboard.cancelled} />
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <h2 className="font-display text-xl font-bold tracking-wide text-foreground">
                Recently updated
              </h2>
              <Link
                to="/projects"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                Open project register
              </Link>
            </div>
            {dashboard.recent.length === 0 ? (
              <EmptyState
                title="No projects yet"
                body="Create an enquiry to start the ProjectHub lifecycle."
                action={
                  hasPermission("projecthub:projects:create") ? (
                    <Link
                      to="/projects/new"
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      New Enquiry
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-2">
                {dashboard.recent.map((row) => (
                  <PanelCard key={row.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: row.id }}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {row.enquiry_reference} · {row.project_type} · updated{" "}
                          {new Date(row.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge tone={statusTone(row.status)}>
                        {PROJECT_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </div>
                  </PanelCard>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-bold text-foreground">{value}</p>
    </div>
  );
}
