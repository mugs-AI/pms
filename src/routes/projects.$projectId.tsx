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
} from "@/components/projecthub/ui";
import { PROJECT_STATUS_LABELS, statusTone } from "@/components/projecthub/status";
import { BoqEditor } from "@/components/projecthub/BoqEditor";
import { PhasesPanel } from "@/components/projecthub/PhasesPanel";
import { ProjectOverview } from "@/components/projecthub/ProjectOverview";
import { SimpleBudgetPanel } from "@/components/projecthub/SimpleBudgetPanel";
import { QuotationPanel } from "@/components/projecthub/QuotationPanel";
import { TeamPanel } from "@/components/projecthub/TeamPanel";
import { useSession } from "@/lib/n3-session";
import { useProjectWorkspace } from "@/lib/projecthub-hooks";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project workspace — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Project overview, phases, team, activity and BOQ or simple budget for a ProjectHub construction project.",
      },
      { property: "og:title", content: "Project workspace — N3 ProjectHub" },
      { property: "og:description", content: "ProjectHub construction project workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Workspace />
    </AppShell>
  ),
});

const TABS = ["Overview", "Phases", "Team", "Activity", "Budget", "Quotation"] as const;

function Workspace() {
  const { projectId } = Route.useParams();
  const { hasPermission } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const query = useProjectWorkspace(projectId, hasPermission("projecthub:projects:list"));

  if (!hasPermission("projecthub:projects:list")) return <AccessState />;
  if (query.isLoading) return <Skeleton rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const ws = query.data?.workspace;
  if (!ws)
    return <EmptyState title="Project not found" body="This project is not visible to you." />;

  const p = ws.project;

  return (
    <div className="space-y-6">
      <PageHeading
        title={p.title}
        subtitle={`${p.enquiry_reference} · ${p.project_type}`}
        actions={
          <Link
            to="/projects"
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Back to projects
          </Link>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</Badge>
        <Badge>{p.budget_mode === "simple_budget" ? "Simple budget" : "Detailed BOQ"}</Badge>
      </div>

      <nav
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        aria-label="Project sections"
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name}
            className={`min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${tab === name ? "border-accent text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? <ProjectOverview projectId={projectId} workspace={ws} /> : null}

      {tab === "Phases" ? <PhasesPanel projectId={projectId} workspace={ws} /> : null}

      {tab === "Team" ? <TeamPanel projectId={projectId} workspace={ws} /> : null}

      {tab === "Activity" ? (
        <div className="grid gap-2">
          {ws.events.length === 0 ? (
            <EmptyState title="No activity yet" body="Project changes appear here." />
          ) : null}
          {ws.events.map((event) => (
            <Card key={event.id}>
              <p className="text-sm text-foreground">{event.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(event.occurred_at).toLocaleString()} · {event.event_type}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "Budget" ? (
        p.budget_mode === "simple_budget" ? (
          <SimpleBudgetPanel projectId={projectId} workspace={ws} />
        ) : (
          <BoqEditor projectId={projectId} workspace={ws} />
        )
      ) : null}

      {tab === "Quotation" ? (
        <QuotationPanel
          projectId={projectId}
          canView={hasPermission("projecthub:projects:view")}
        />
      ) : null}
    </div>
  );
}
