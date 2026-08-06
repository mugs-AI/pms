import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useSession } from "@/lib/n3-session";
import { DevApiKeyLogin } from "@/components/DevApiKeyLogin";
import type { Permission } from "@/lib/projecthub-rbac";

const NAV: { to: string; label: string; permission?: Permission; ownerOnly?: boolean }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects", permission: "projecthub:projects:list" },
  { to: "/roles", label: "Team & Roles", permission: "projecthub:roles:manage" },
  { to: "/verification", label: "N3 Data Verification", ownerOnly: true },
  { to: "/capabilities", label: "Capability Inventory", ownerOnly: true },
];

function SessionField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-semibold tracking-widest text-primary-foreground/60 uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm text-primary-foreground">{value ?? "—"}</dd>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const loading = session.status === "loading";

  if (session.status === "anonymous" || session.status === "error") {
    return <UnauthenticatedScreen />;
  }

  // Navigation follows the server-returned permission set, never a local guess.
  const nav = NAV.filter((item) => {
    if (item.ownerOnly) return session.isOwner;
    if (item.permission) return session.hasPermission(item.permission);
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary shadow-header">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent font-display text-lg font-bold text-accent-foreground">
              PH
            </span>
            <div>
              <p className="font-display text-xl leading-none font-bold tracking-wide text-primary-foreground">
                N3 ProjectHub
              </p>
              <p className="text-xs text-primary-foreground/60">
                Construction &amp; renovation PMS for N3
              </p>
            </div>
          </div>

          <dl className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <SessionField label="Company" value={loading ? "…" : session.companyName} />
            <SessionField label="Tenant code" value={loading ? "…" : session.tenantCode} />
            <SessionField label="User email" value={loading ? "…" : session.email} />
            <SessionField label="ProjectHub role" value={loading ? "…" : session.roleLabel} />
          </dl>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs text-primary-foreground">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${loading ? "bg-accent" : "bg-success"}`}
              />
              {loading ? "Connecting to N3" : "N3 session active"}
            </span>
            <button
              type="button"
              onClick={session.signOut}
              className="rounded-md border border-primary-foreground/25 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav aria-label="Main" className="border-t border-primary-foreground/10">
          <div className="mx-auto max-w-6xl px-4">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="my-2 rounded-md border border-primary-foreground/25 px-3 py-1.5 text-xs text-primary-foreground sm:hidden"
            >
              {open ? "Hide menu" : "Menu"}
            </button>
            <ul
              className={`${open ? "flex" : "hidden"} flex-col gap-1 pb-2 sm:flex sm:flex-row sm:gap-1 sm:pb-0`}
            >
              {nav.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setOpen(false)}
                    activeOptions={{ exact: item.to === "/" }}
                    activeProps={{
                      className: "border-accent text-primary-foreground bg-primary-foreground/10",
                    }}
                    inactiveProps={{
                      className: "border-transparent text-primary-foreground/70",
                    }}
                    className="block border-b-2 px-3 py-2 text-sm font-medium transition-colors hover:text-primary-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {!loading && session.roleStatus === "unassigned" ? <RoleUnassignedBanner /> : null}
        {!loading && session.roleStatus === "disabled" ? <AccessBanner
          title="ProjectHub access disabled"
          body="Your ProjectHub access has been deactivated. Ask your N3 account owner to reactivate it."
        /> : null}
        {!loading && session.roleStatus === "identity_missing" ? <AccessBanner
          title="N3 identity incomplete"
          body="Your N3 session did not return a usable immutable user identity. Relaunch ProjectHub from N3 My Apps."
        /> : null}
        {children}
      </main>
    </div>
  );
}

function AccessBanner({ title, body }: { title: string; body: string }) {
  return (
    <section className="mb-6 rounded-lg border border-accent/40 bg-accent/10 p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </section>
  );
}

function RoleUnassignedBanner() {
  return (
    <AccessBanner
      title="Role unassigned"
      body="Ask your N3 account owner to assign a ProjectHub role."
    />
  );
}

function UnauthenticatedScreen() {
  const { error } = useSession();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary font-display text-xl font-bold text-primary-foreground">
            PH
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-wide text-foreground">
            N3 ProjectHub
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open this app from N3 AI Cloud Accounting → Marketplace → My Apps → Open. Your N3
            session is the only sign-in.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        {import.meta.env.DEV ? <DevApiKeyLogin /> : null}
      </div>
    </div>
  );
}
