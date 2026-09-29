import { Link } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { useSession } from "@/lib/n3-session";
import { DevApiKeyLogin } from "@/components/DevApiKeyLogin";
import type { Permission } from "@/lib/projecthub-rbac";
import { useDisplayWidth, widthContainerClass } from "@/lib/display-preference";
import { useRootFontSize } from "@/lib/font-preference";
import { clearWorkspaceTabs } from "@/lib/workspace-tabs";
import { useWorkspaceLifecycle } from "@/lib/workspace-lifecycle";
import { WorkspaceTabs, type ActiveWorkspace } from "@/components/projecthub/WorkspaceTabs";

// Compact top-level shell. The Owner-only global history link follows the
// server-resolved N3 identity and permission set.
// Team & Roles, N3 Data Verification and Capability Inventory now live inside
// Settings. Settings itself is always reachable; each module inside it is
// permission-filtered, and every route keeps its own server-side authorization.
const NAV: { to: string; label: string; permission?: Permission; ownerOnly?: boolean }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects", permission: "projecthub:projects:list" },
  {
    to: "/settings/history",
    label: "Global History",
    permission: "projecthub:history:view_all",
    ownerOnly: true,
  },
  { to: "/settings", label: "Settings" },
];

export function AppShell({
  children,
  activeWorkspace,
}: {
  children: ReactNode;
  activeWorkspace?: ActiveWorkspace;
}) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [width] = useDisplayWidth();
  useRootFontSize();
  const container = widthContainerClass(width);
  const loading = session.status === "loading";
  useWorkspaceLifecycle(session);

  if (session.status === "anonymous" || session.status === "error") {
    return <UnauthenticatedScreen />;
  }

  // Navigation follows the server-returned permission set, never a local guess.
  const nav = NAV.filter((item) => {
    if (item.ownerOnly && (session.status !== "authenticated" || !session.isOwner)) return false;
    if (item.permission && !session.hasPermission(item.permission)) return false;
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

      <header className="border-b border-border bg-card shadow-header">
        <div className={`${container} flex flex-wrap items-center gap-x-5 gap-y-1 py-2`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary font-display text-lg font-bold text-primary-foreground">
              PH
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-none font-bold tracking-wide text-foreground">
                N3 ProjectHub
              </p>
              {/* Company context only. Tenant code, email, immutable ids and
                    session diagnostics are deliberately not shown here. */}
              {loading ? (
                <span className="mt-1 hidden h-3 w-32 max-w-full rounded bg-secondary motion-safe:animate-pulse sm:block" />
              ) : (
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {session.companyName ?? "Construction & renovation PMS for N3"}
                </p>
              )}
            </div>
          </div>
          <nav
            aria-label="Main"
            className="order-3 w-full lg:order-none lg:min-w-0 lg:flex-1"
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                setOpen(false);
                menuButton.current?.focus();
              }
            }}
          >
            <ul
              id="primary-navigation"
              className={`${open ? "flex" : "hidden"} flex-col border-t border-border py-2 lg:flex lg:flex-row lg:items-center lg:gap-1 lg:border-0 lg:py-0`}
            >
              {nav.map((item) => (
                <li key={item.to} className="min-w-0">
                  <Link
                    to={item.to}
                    onClick={() => setOpen(false)}
                    activeOptions={{
                      exact:
                        item.to === "/" ||
                        item.to === "/settings" ||
                        item.to === "/settings/history",
                    }}
                    activeProps={{
                      className: "border-accent bg-accent/10 text-foreground",
                      "aria-current": "page",
                    }}
                    inactiveProps={{ className: "border-transparent text-muted-foreground" }}
                    className="flex min-h-11 w-full items-center rounded-t-sm border-b-2 px-3 text-sm font-medium transition-colors hover:bg-secondary hover:text-foreground lg:w-auto"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              ref={menuButton}
              type="button"
              aria-expanded={open}
              aria-controls="primary-navigation"
              onClick={() => setOpen((v) => !v)}
              className="min-h-11 rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-secondary lg:hidden"
            >
              {open ? "Hide menu" : "Menu"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearWorkspaceTabs();
                session.signOut();
              }}
              className="min-h-11 rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Sign out
            </button>
          </div>
        </div>
        <WorkspaceTabs {...(activeWorkspace ? { active: activeWorkspace } : {})} />
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
