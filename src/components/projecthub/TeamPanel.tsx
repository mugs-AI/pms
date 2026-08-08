/**
 * Team tab. Candidates come from the tenant-scoped server endpoint and the
 * browser only ever sends an N3 user id — display name, email, role snapshot
 * and tenant identity are resolved server-side.
 */
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorState, Field, Skeleton, inputClass } from "./ui";
import { projectHubRequest } from "@/lib/projecthub-client";
import { useProjectMutation, useTeamCandidates, type Workspace } from "@/lib/projecthub-hooks";
import { ROLE_LABELS, type ProjectHubRole } from "@/lib/projecthub-rbac";

export function TeamPanel({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const cancelled = workspace.project.status === "cancelled_lost";
  const canManage = workspace.capabilities.canManageTeam && !cancelled;
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const assign = useProjectMutation(projectId, (n3UserId: string) =>
    projectHubRequest(`projects/${projectId}/team/${encodeURIComponent(n3UserId)}`, {
      method: "PUT",
      body: {},
    }),
  );
  const deactivate = useProjectMutation(projectId, (n3UserId: string) =>
    projectHubRequest(`projects/${projectId}/team/${encodeURIComponent(n3UserId)}`, {
      method: "DELETE",
    }),
  );

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <button
          type="button"
          onClick={() => setAssigning((v) => !v)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {assigning ? "Close" : "Assign team member"}
        </button>
      ) : null}

      {assigning && canManage ? (
        <AssignForm
          assigned={workspace.team.filter((m) => m.is_active).map((m) => m.n3_user_id)}
          pending={assign.isPending}
          error={assign.isError ? assign.error : null}
          onAssign={(n3UserId) =>
            assign.mutate(n3UserId, {
              onSuccess: () => {
                setAssigning(false);
                setNotice("Team member assigned.");
              },
            })
          }
        />
      ) : null}

      {deactivate.isError ? <ErrorState error={deactivate.error} /> : null}

      {workspace.team.length === 0 ? (
        <EmptyState title="No team members" body="Nobody is assigned to this project yet." />
      ) : null}

      {workspace.team.map((member) => (
        <Card key={member.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground">{member.display_name ?? "N3 user"}</p>
              <p className="text-sm text-muted-foreground">{member.display_email ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[(member.project_role_snapshot ?? "unassigned") as ProjectHubRole] ??
                  member.project_role_snapshot}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={member.is_active ? "success" : "destructive"}>
                {member.is_active ? "Active" : "Inactive"}
              </Badge>
              {canManage && member.is_active ? (
                <button
                  type="button"
                  disabled={deactivate.isPending}
                  onClick={() =>
                    deactivate.mutate(member.n3_user_id, {
                      onSuccess: () => setNotice("Team member deactivated."),
                    })
                  }
                  className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary disabled:opacity-60"
                >
                  Deactivate
                </button>
              ) : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AssignForm({
  assigned,
  pending,
  error,
  onAssign,
}: {
  assigned: string[];
  pending: boolean;
  error: unknown;
  onAssign: (n3UserId: string) => void;
}) {
  const query = useTeamCandidates(true);
  const [selected, setSelected] = useState("");

  if (query.isLoading) return <Skeleton rows={2} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const candidates = (query.data?.candidates ?? []).filter((c) => !assigned.includes(c.n3UserId));

  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg font-bold text-foreground">Assign team member</h2>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No further candidates. Only active tenant users holding a ProjectHub role can be assigned.
        </p>
      ) : (
        <>
          <Field label="Candidate">
            <select
              className={inputClass}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select a ProjectHub user…</option>
              {candidates.map((candidate) => (
                <option key={candidate.n3UserId} value={candidate.n3UserId}>
                  {candidate.displayName ?? candidate.n3UserId}
                  {candidate.displayEmail ? ` — ${candidate.displayEmail}` : ""} (
                  {ROLE_LABELS[candidate.role as ProjectHubRole] ?? candidate.role})
                </option>
              ))}
            </select>
          </Field>
          {error ? <ErrorState error={error} /> : null}
          <button
            type="button"
            disabled={!selected || pending}
            onClick={() => onAssign(selected)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? "Assigning…" : "Assign to project"}
          </button>
        </>
      )}
    </Card>
  );
}
