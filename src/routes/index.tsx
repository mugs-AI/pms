import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/n3-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — N3 ProjectHub" },
      {
        name: "description",
        content:
          "ProjectHub dashboard shell showing the live N3 session, company and tenant context for construction project management.",
      },
      { property: "og:title", content: "Dashboard — N3 ProjectHub" },
      {
        property: "og:description",
        content:
          "ProjectHub dashboard shell showing the live N3 session, company and tenant context for construction project management.",
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
  const { companyName, tenantCode, email, isOwner } = useSession();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Starter foundation only — project KPIs, cash flow and budget-versus-actual arrive in later
          milestones.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="N3 company" value={companyName ?? "…"} note="From CompanyProfile/BasicInfo" />
        <Card
          title="Tenant code"
          value={tenantCode ?? "…"}
          note="Never derived from the tenant GUID"
        />
        <Card
          title="Signed-in user"
          value={email ?? "…"}
          note={isOwner ? "N3 account owner" : "Standard N3 user"}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Placeholder
          title="Project cockpit"
          body="Enquiries, awards, BOQ, variation orders, progress claims and retention will be built on top of this foundation."
        />
        <Placeholder
          title="Cost &amp; procurement"
          body="Purchase requisitions, purchase orders, GRN, purchase invoices and payments remain in N3 as the accounting source of truth."
        />
      </section>

      {isOwner ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h2 className="font-display text-xl font-bold tracking-wide text-foreground">
            Verify the integration
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read N3 master data through the same-origin proxy to prove the tenant, user and paging
            behaviour before any write milestone begins.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/verification"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              N3 Data Verification
            </Link>
            <Link
              to="/capabilities"
              className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              Capability inventory
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Card({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </p>
      <p className="mt-2 truncate text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-bold tracking-wide text-foreground">{title}</h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide text-secondary-foreground uppercase">
          Not implemented
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
