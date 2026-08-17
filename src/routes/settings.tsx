import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, PageHeading, inputClass } from "@/components/projecthub/ui";
import { DisplayWidthControl } from "@/components/projecthub/DisplayWidthControl";
import { useSession } from "@/lib/n3-session";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — N3 ProjectHub" },
      {
        name: "description",
        content:
          "ProjectHub settings: team and role administration, N3 data verification, capability inventory and desktop display width.",
      },
      { property: "og:title", content: "Settings — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Administration and display preferences for N3 ProjectHub.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

type Module = {
  to: string;
  title: string;
  body: string;
  scope: string;
};

function SettingsPage() {
  const { hasPermission, isOwner } = useSession();
  const [search, setSearch] = useState("");

  // Presentation filter only. Each route below re-checks authority server-side,
  // so hiding a card is never the security boundary.
  const modules = useMemo<Module[]>(() => {
    const all: (Module & { visible: boolean })[] = [
      {
        to: "/roles",
        title: "Team & Roles",
        body: "Assign and deactivate ProjectHub roles for users in your N3 company directory.",
        scope: "Requires role administration",
        visible: hasPermission("projecthub:roles:manage"),
      },
      {
        to: "/verification",
        title: "N3 Data Verification",
        body: "Read-only proof that ProjectHub reads live, tenant-correct N3 master data.",
        scope: "Owner only",
        visible: isOwner,
      },
      {
        to: "/capabilities",
        title: "Capability Inventory",
        body: "The N3 operations ProjectHub can read today and the ones deliberately not built yet.",
        scope: "Owner only",
        visible: isOwner,
      },
    ];
    return all.filter((module) => module.visible).map(({ visible: _v, ...rest }) => rest);
  }, [hasPermission, isOwner]);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? modules.filter((module) =>
        `${module.title} ${module.body}`.toLowerCase().includes(term),
      )
    : modules;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Settings"
        subtitle="Administration and display preferences. Nothing on this page writes to N3."
      />

      <Card className="space-y-3">
        <h2 className="font-display text-lg font-bold tracking-wide text-foreground">Display</h2>
        <p className="text-sm text-muted-foreground">
          Choose how wide ProjectHub pages are on a desktop screen. This preference is stored in
          this browser only and contains no company, user or session information.
        </p>
        <DisplayWidthControl />
      </Card>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-display text-lg font-bold tracking-wide text-foreground">
            Administration
          </h2>
          {modules.length > 0 ? (
            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Search settings modules</span>
                <input
                  type="search"
                  className={inputClass}
                  placeholder="Search settings"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="min-h-11 shrink-0 rounded-md border border-input px-3 text-sm font-medium hover:bg-secondary"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        {modules.length === 0 ? (
          <EmptyState
            title="No settings available"
            body="Your ProjectHub role does not include any administration module. Ask your N3 account owner if you need access."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matching settings" body="Clear the search to see every module." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((module) => (
              <Link
                key={module.to}
                to={module.to}
                className="block rounded-lg border border-border bg-card p-5 shadow-card transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  {module.scope}
                </p>
                <h3 className="mt-1 font-display text-lg font-bold tracking-wide text-foreground">
                  {module.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{module.body}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
