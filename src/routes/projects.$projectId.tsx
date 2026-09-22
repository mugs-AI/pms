import { formatMalaysianDateTime } from "@/lib/projecthub-date";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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
import {
  normaliseSection,
  openProjectWorkspace,
  removeWorkspaceTab,
  type ProjectSection,
} from "@/lib/workspace-tabs";
import { ProjectHubError } from "@/lib/projecthub-client";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: normaliseSection(search["section"]),
  }),
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
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const { section } = Route.useSearch();
  return (
    <AppShell activeWorkspace={{ kind: "project", projectId, section }}>
      <Workspace />
    </AppShell>
  );
}

const ALL_TABS: { label: string; value: ProjectSection }[] = [
  { label: "Overview", value: "overview" },
  { label: "Phases", value: "phases" },
  { label: "Team", value: "team" },
  { label: "Activity", value: "activity" },
  { label: "Budget", value: "budget" },
  { label: "Quotation", value: "quotation" },
];

function Workspace() {
  const { projectId } = Route.useParams();
  const { section: requestedSection } = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/$projectId" });
  const { hasPermission } = useSession();
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  // The Quotation preview endpoint is authorised server-side with
  // `projecthub:boq:view`; the tab must use the same permission so roles
  // without BOQ visibility are never offered a tab that will be denied.
  const canViewQuotation = hasPermission("projecthub:boq:view");
  const tabs = ALL_TABS.filter((item) => item.value !== "quotation" || canViewQuotation);
  const section =
    requestedSection === "quotation" && !canViewQuotation ? "overview" : requestedSection;
  const query = useProjectWorkspace(projectId, hasPermission("projecthub:projects:list"));
  const ws = query.data?.workspace;

  useEffect(() => {
    if (requestedSection === "quotation" && !canViewQuotation) {
      void navigate({ search: { section: "overview" }, replace: true });
    }
  }, [requestedSection, canViewQuotation, navigate]);

  useEffect(() => {
    if (!ws) return;
    openProjectWorkspace({
      projectId,
      reference: ws.project.enquiry_reference,
      title: ws.project.title,
      section,
    });
  }, [projectId, section, ws]);

  useEffect(() => {
    if (!query.isError) return;
    if (query.error instanceof ProjectHubError && [403, 404].includes(query.error.status)) {
      removeWorkspaceTab(`project:${projectId}`);
    }
  }, [projectId, query.error, query.isError]);

  if (!hasPermission("projecthub:projects:list")) return <AccessState />;
  if (query.isLoading) return <Skeleton rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!ws)
    return <EmptyState title="Project not found" body="This project is not visible to you." />;

  const p = ws.project;

  return (
    <div className="space-y-6">
      <PageHeading
        title={p.title}
        subtitle={`${p.enquiry_reference} · ${p.project_type}`}
        actions={
          <>
            <Link
              to="/projects"
              className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              Back to projects
            </Link>
            <Link
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ section }}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open current project section in new tab"
              className="px-2 text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Open in new tab ↗
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(p.status)}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</Badge>
        <Badge>{p.budget_mode === "simple_budget" ? "Simple budget" : "Detailed BOQ"}</Badge>
      </div>

      <nav
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        aria-label="Project sections"
        role="tablist"
      >
        {tabs.map((item, index) => (
          <Link
            key={item.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            aria-selected={section === item.value}
            aria-controls="project-active-panel"
            id={`project-tab-${item.value}`}
            tabIndex={section === item.value ? 0 : -1}
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ section: item.value }}
            onKeyDown={(event) => {
              let target = index;
              if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") target = 0;
              else if (event.key === "End") target = tabs.length - 1;
              else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.click();
                return;
              }
              else return;
              event.preventDefault();
              tabRefs.current[target]?.focus();
            }}
            className={`min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${section === item.value ? "border-accent text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section
        role="tabpanel"
        id="project-active-panel"
        aria-labelledby={`project-tab-${section}`}
      >
        {section === "overview" ? <ProjectOverview projectId={projectId} workspace={ws} /> : null}

        {section === "phases" ? <PhasesPanel projectId={projectId} workspace={ws} /> : null}

        {section === "team" ? <TeamPanel projectId={projectId} workspace={ws} /> : null}

        {section === "activity" ? (
          <div className="grid gap-2">
            {ws.events.length === 0 ? (
              <EmptyState title="No activity yet" body="Project changes appear here." />
            ) : null}
            {ws.events.map((event) => (
              <Card key={event.id}>
                <p className="text-sm text-foreground">{event.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMalaysianDateTime(event.occurred_at)} · {event.event_type}
                </p>
              </Card>
            ))}
          </div>
        ) : null}

        {section === "budget" ? (
          p.budget_mode === "simple_budget" ? (
            <SimpleBudgetPanel projectId={projectId} workspace={ws} />
          ) : (
            <BoqEditor projectId={projectId} workspace={ws} />
          )
        ) : null}

        {section === "quotation" && canViewQuotation ? (
          <QuotationPanel projectId={projectId} canView={canViewQuotation} />
        ) : null}
      </section>
    </div>
  );
}
