import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useSession } from "@/lib/n3-session";
import { DevApiKeyLogin } from "@/components/DevApiKeyLogin";
import type { Permission } from "@/lib/projecthub-rbac";
import { useDisplayWidth, widthContainerClass, type DisplayWidth } from "@/lib/display-preference";

const NAV: { to: string; label: string; permission?: Permission; ownerOnly?: boolean }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects", permission: "projecthub:projects:list" },
  { to: "/roles", label: "Team & Roles", permission: "projecthub:roles:manage" },
  { to: "/verification", label: "N3 Data Verification", ownerOnly: true },
  { to: "/capabilities", label: "Capability Inventory", ownerOnly: true },
];

function SessionField({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | null;
  loading: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-semibold tracking-widest text-primary-foreground/60 uppercase">
        {label}
      </dt>
      {loading ? (
        <dd className="mt-1 h-4 w-24 max-w-full animate-pulse rounded bg-primary-foreground/15" />
      ) : (
        <dd className="truncate text-sm text-primary-foreground" title={value ?? undefined}>
          {value ?? "—"}
        </dd>
      )}
    </div>
  );
}

const WIDTH_OPTIONS: { value: DisplayWidth; label: string; title: string }[] = [
  { value: "standard", label: "Standard", title: "Centered layout, capped for readability" },
  { value: "full", label: "Full width", title: "Use the full browser workspace" },
];

export function DisplayWidthToggle({ className = "" }: { className?: string }) {
  const [width, setWidth] = useDisplayWidth();
  return (
    <div
      role="radiogroup"
      aria-label="Desktop display width"
      className={`inline-flex shrink-0 rounded-md border border-primary-foreground/25 p-0.5 ${className}`}
    >
      {WIDTH_OPTIONS.map((option) => {
        const checked = width === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            title={option.title}
            onClick={() => setWidth(option.value)}
            className={`min-h-10 rounded px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              checked
                ? "bg-accent text-accent-foreground"
                : "text-primary-foreground/75 hover:text-primary-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [width] = useDisplayWidth();
  const container = widthContainerClass(width);
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
    <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
      >
        Skip to main content
      </a>

      <header className="bg-primary shadow-header">
        <div
          className={`${container} flex flex-col gap-3 py-3 md:flex-row md:flex-wrap md:items-center md:gap-4`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent font-display text-lg font-bold text-accent-foreground">
                PH
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-xl leading-none font-bold tracking-wide text-primary-foreground">
                  N3 ProjectHub
                </p>
                <p className="truncate text-xs text-primary-foreground/60">
                  Construction &amp; renovation PMS for N3
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 md:hidden">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${loading ? "bg-accent" : "bg-success"}`}
              />
              <span className="sr-only">{loading ? "Connecting to N3" : "N3 session active"}</span>
              <button
                type="button"
                onClick={session.signOut}
                className="min-h-10 rounded-md border border-primary-foreground/25 px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                Sign out
              </button>
            </div>
          </div>

          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 md:ml-auto md:grid-cols-3 md:gap-y-1">
            <SessionField label="Company" value={session.companyName} loading={loading} />
            <SessionField label="Tenant code" value={session.tenantCode} loading={loading} />
            <SessionField label="User email" value={session.email} loading={loading} />
            <SessionField label="ProjectHub role" value={session.roleLabel} loading={loading} />
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <DisplayWidthToggle />
            <span className="hidden items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs text-primary-foreground md:inline-flex">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${loading ? "bg-accent" : "bg-success"}`}
              />
              {loading ? "Connecting to N3" : "N3 session active"}
            </span>
            <button
              type="button"
              onClick={session.signOut}
              className="hidden min-h-10 rounded-md border border-primary-foreground/25 px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10 md:block"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav aria-label="Main" className="border-t border-primary-foreground/10">
          <div className={container}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="primary-navigation"
              onClick={() => setOpen((v) => !v)}
              className="my-2 min-h-10 w-full rounded-md border border-primary-foreground/25 px-3 text-xs font-medium text-primary-foreground sm:hidden"
            >
              {open ? "Hide menu" : "Menu"}
            </button>
            <ul
              id="primary-navigation"
              className={`${open ? "flex" : "hidden"} flex-col gap-1 pb-2 sm:flex sm:flex-row sm:gap-1 sm:pb-0`}
            >
              {nav.map((item) => (
                <li key={item.to} className="min-w-0">
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
                    className="block w-full border-b-2 px-3 py-3 text-sm font-medium transition-colors hover:text-primary-foreground sm:py-2"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </header>

      <main id="main-content" className={`${container} py-6 sm:py-8`}>
        {!loading && session.roleStatus === "unassigned" ? <RoleUnassignedBanner /> : null}
        {!loading && session.roleStatus === "disabled" ? (
          <AccessBanner
            title="ProjectHub access disabled"
            body="Your ProjectHub access has been deactivated. Ask your N3 account owner to reactivate it."
          />
        ) : null}
        {!loading && session.roleStatus === "identity_missing" ? (
          <AccessBanner
            title="N3 identity incomplete"
            body="Your N3 session did not return a usable immutable user identity. Relaunch ProjectHub from N3 My Apps."
          />
        ) : null}
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
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
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
