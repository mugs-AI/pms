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
import { useSession } from "@/lib/n3-session";
import { useBoq, useProjectWorkspace } from "@/lib/projecthub-hooks";
import {
  formatMoney,
  formatPercent,
  simpleBudgetTotals,
  summariseBoq,
} from "@/lib/projecthub-calc";
import {
  ITEM_TYPE_LABELS,
  PHASE_LINK_LABELS,
  STOCK_DEDUCTION_LABELS,
} from "@/lib/projecthub-schemas";

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

const TABS = ["Overview", "Phases", "Team", "Activity", "Budget"] as const;

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

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Project sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === name ? "border-accent text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? (
        <Card className="grid gap-4 sm:grid-cols-2">
          <Detail label="Enquiry date" value={p.enquiry_date} />
          <Detail label="Expected start" value={p.expected_start_date} />
          <Detail label="Expected end" value={p.expected_end_date} />
          <Detail
            label="Customer"
            value={p.n3_customer_name ?? p.requested_customer_name ?? "Not recorded"}
          />
          <Detail label="Customer link" value={p.customer_link_status} />
          <Detail
            label="Primary N3 project code"
            value={p.primary_project_code ?? "Not linked in N3"}
          />
          <Detail
            label="Site"
            value={
              [p.site_address_line1, p.site_city, p.site_state, p.site_postcode]
                .filter(Boolean)
                .join(", ") || "—"
            }
          />
          <Detail label="Description" value={p.description ?? "—"} />
          {p.cancellation_reason ? (
            <Detail label="Cancellation reason" value={p.cancellation_reason} />
          ) : null}
        </Card>
      ) : null}

      {tab === "Phases" ? (
        <div className="grid gap-3">
          {ws.phases.length === 0 ? (
            <EmptyState title="No phases" body="This project has no phases yet." />
          ) : null}
          {ws.phases.map((phase) => (
            <Card key={phase.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{phase.phase_name}</p>
                <div className="flex gap-2">
                  <Badge tone={phase.is_active ? "success" : "destructive"}>
                    {phase.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge tone="accent">
                    {PHASE_LINK_LABELS[phase.link_status as keyof typeof PHASE_LINK_LABELS] ??
                      phase.link_status}
                  </Badge>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {phase.n3_project_code
                  ? `Linked N3 code ${phase.n3_project_code}`
                  : phase.requested_n3_project_code
                    ? `Requested code ${phase.requested_n3_project_code} — not created in N3 yet`
                    : "No N3 project code"}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "Team" ? (
        <div className="grid gap-3">
          {ws.team.length === 0 ? (
            <EmptyState title="No team members" body="Nobody is assigned to this project yet." />
          ) : null}
          {ws.team.map((member) => (
            <Card key={member.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">
                    {member.display_name ?? "N3 user"}
                  </p>
                  <p className="text-sm text-muted-foreground">{member.display_email ?? "—"}</p>
                </div>
                <Badge tone={member.is_active ? "success" : "destructive"}>
                  {member.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

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
          <SimpleBudget cost={p.simple_budget_cost} selling={p.simple_budget_selling} />
        ) : (
          <BoqPanel projectId={projectId} />
        )
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function SimpleBudget({ cost, selling }: { cost: string | null; selling: string | null }) {
  const totals = simpleBudgetTotals(cost, selling);
  return (
    <Card className="grid gap-4 sm:grid-cols-4">
      <Detail label="Budget cost" value={formatMoney(totals.totalCost)} />
      <Detail label="Budget selling" value={formatMoney(totals.totalSelling)} />
      <Detail label="Profit" value={formatMoney(totals.grossProfit)} />
      <Detail label="Margin" value={formatPercent(totals.grossMarginPercent)} />
    </Card>
  );
}

function BoqPanel({ projectId }: { projectId: string }) {
  const [versionId, setVersionId] = useState<string | undefined>(undefined);
  const query = useBoq(projectId, versionId, true);

  if (query.isLoading) return <Skeleton rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const boq = query.data?.boq;
  if (!boq || !boq.version) {
    return (
      <EmptyState
        title="No BOQ version yet"
        body="An estimator can create the first draft BOQ version for this project."
      />
    );
  }

  const summary = summariseBoq(
    boq.items.map((item) => ({
      itemType: item.item_type,
      quantity: item.quantity,
      costRate: item.cost_rate,
      sellingRate: item.selling_rate,
      taxRate: item.tax_rate,
      sectionId: item.section_id,
      projectPhaseId: item.project_phase_id,
    })),
  );

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="mr-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Version
          </span>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={boq.version.id}
            onChange={(event) => setVersionId(event.target.value)}
          >
            {boq.versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.version_number} {version.revision_label ?? ""} · {version.status}
              </option>
            ))}
          </select>
        </label>
        <Badge tone={boq.version.status === "superseded" ? "destructive" : "accent"}>
          {boq.version.status}
        </Badge>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-5">
        <Detail label="Cost" value={formatMoney(summary.totals.totalCost)} />
        <Detail label="Selling" value={formatMoney(summary.totals.totalSelling)} />
        <Detail label="Tax" value={formatMoney(summary.totals.totalTax)} />
        <Detail label="Selling incl. tax" value={formatMoney(summary.totals.totalSellingWithTax)} />
        <Detail label="Margin" value={formatPercent(summary.totals.grossMarginPercent)} />
      </Card>

      {boq.items.length === 0 ? (
        <EmptyState
          title="No BOQ lines yet"
          body="Add sections and items to build this bill of quantities."
        />
      ) : (
        <div className="grid gap-3">
          {boq.items.map((item, index) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {ITEM_TYPE_LABELS[item.item_type as keyof typeof ITEM_TYPE_LABELS] ??
                      item.item_type}{" "}
                    · {item.quantity} {item.uom_code ?? ""}
                    {item.stock_deduction_method
                      ? ` · ${STOCK_DEDUCTION_LABELS[item.stock_deduction_method as keyof typeof STOCK_DEDUCTION_LABELS]}`
                      : ""}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p>{formatMoney(summary.lines[index]?.sellingAmount ?? "0")}</p>
                  <p className="text-xs text-muted-foreground">
                    cost {formatMoney(summary.lines[index]?.costAmount ?? "0")}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
