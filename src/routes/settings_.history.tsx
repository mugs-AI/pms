import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HistoryGrid } from "@/components/projecthub/HistoryGrid";
import { EmptyState, PageHeading } from "@/components/projecthub/ui";
import { useSession } from "@/lib/n3-session";

export const Route = createFileRoute("/settings_/history")({
  head: () => ({
    meta: [
      { title: "Global History — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Owner-only tenant-wide history of every ProjectHub project with filters, sorting and Excel export.",
      },
      { property: "og:title", content: "Global History — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Search every ProjectHub project's history in one grid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <GlobalHistoryPage />
    </AppShell>
  ),
});

function GlobalHistoryPage() {
  const { isOwner, hasPermission } = useSession();
  // Presentation gate only; the server re-checks exact Owner authority.
  if (!isOwner || !hasPermission("projecthub:history:view_all")) {
    return (
      <EmptyState
        title="Owner access required"
        body="Global History is limited to the N3 account owner. Project history remains available inside each project you can see."
      />
    );
  }
  return (
    <div className="space-y-6">
      <PageHeading
        title="Global History"
        subtitle="Every ProjectHub project in your company. Times are Malaysia time. Nothing here writes to N3."
      />
      <HistoryGrid
        scope="global"
        canExport={hasPermission("projecthub:history:export_all")}
        label="Global ProjectHub history"
      />
    </div>
  );
}
