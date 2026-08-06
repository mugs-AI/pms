import { createFileRoute } from "@tanstack/react-router";
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
import { useAssignRole, useRoleDirectory, type RoleDirectoryEntry } from "@/lib/projecthub-hooks";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type ProjectHubRole } from "@/lib/projecthub-rbac";
import { describeError } from "@/lib/projecthub-client";

export const Route = createFileRoute("/roles")({
  head: () => ({
    meta: [
      { title: "Team & Roles — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Assign ProjectHub roles to live N3 users. Owner authority always comes from N3 CompanyProfile BasicInfo.",
      },
      { property: "og:title", content: "Team & Roles — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Owner-only ProjectHub role assignment backed by the live N3 user directory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <RolesPage />
    </AppShell>
  ),
});

function RolesPage() {
  const { hasPermission } = useSession();
  const [search, setSearch] = useState("");
  const allowed = hasPermission("projecthub:roles:manage");
  const directory = useRoleDirectory(search, allowed);

  if (!allowed) return <AccessState />;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Team & Roles"
        subtitle="Only a live N3 account owner can grant ProjectHub access. Owner itself is never assignable."
      />

      <Card>
        <label className="block max-w-md">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Search N3 users
          </span>
          <input
            type="search"
            className={`${inputClass} mt-1`}
            placeholder="Name, code or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </Card>

      {directory.isLoading ? <Skeleton rows={5} /> : null}
      {directory.isError ? (
        <ErrorState error={directory.error} onRetry={() => void directory.refetch()} />
      ) : null}
      {directory.data && directory.data.entries.length === 0 ? (
        <EmptyState
          title="No N3 users found"
          body="No user in the live N3 directory matches this search."
        />
      ) : null}

      {directory.data?.n3DirectoryAvailable === false ? (
        <p className="text-sm text-muted-foreground">
          The live N3 user directory is temporarily unavailable; stored ProjectHub roles are shown.
        </p>
      ) : null}

      <div className="grid gap-3">
        {directory.data?.entries.map((entry) => (
          <RoleRow key={entry.n3UserId} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function RoleRow({ entry }: { entry: RoleDirectoryEntry }) {
  const [role, setRole] = useState<ProjectHubRole>(
    entry.role === "owner" ? "unassigned" : entry.role,
  );
  const [isActive, setIsActive] = useState(entry.isActive);
  const [saved, setSaved] = useState(false);
  const assign = useAssignRole();
  const isOwnerRow = entry.role === "owner";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">
            {entry.displayName ?? "Unnamed N3 user"}
          </p>
          <p className="truncate text-sm text-muted-foreground">{entry.displayEmail ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            N3 user {maskId(entry.n3UserId)} · {entry.roleLabel}
            {entry.roleSource ? ` · source ${entry.roleSource}` : ""}
            {entry.assignedAt ? ` · assigned ${new Date(entry.assignedAt).toLocaleString()}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={entry.isActive ? "success" : "destructive"}>
              {entry.isActive ? "Active" : "Inactive"}
            </Badge>
            {entry.inN3Directory ? (
              <Badge>In N3 directory</Badge>
            ) : (
              <Badge tone="destructive">Not in N3</Badge>
            )}
          </div>
        </div>

        {isOwnerRow ? (
          <p className="text-sm text-muted-foreground">
            Owner authority comes from N3 and cannot be edited.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                ProjectHub role
              </span>
              <select
                aria-label={`ProjectHub role for ${entry.displayName ?? entry.n3UserId}`}
                className={`${inputClass} mt-1`}
                value={role}
                onChange={(event) => setRole(event.target.value as ProjectHubRole)}
              >
                {ASSIGNABLE_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              Access active
            </label>
            <button
              type="button"
              disabled={assign.isPending || !entry.inN3Directory}
              onClick={() => {
                setSaved(false);
                assign.mutate(
                  { n3UserId: entry.n3UserId, role, isActive },
                  { onSuccess: () => setSaved(true) },
                );
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {assign.isPending ? "Saving…" : "Save role"}
            </button>
          </div>
        )}
      </div>
      {assign.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {describeError(assign.error).message}
        </p>
      ) : null}
      {saved ? (
        <p className="mt-3 text-sm text-success">Role saved. The user sees it on next refresh.</p>
      ) : null}
    </Card>
  );
}

function maskId(id: string): string {
  return id.length <= 8 ? "••••" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
