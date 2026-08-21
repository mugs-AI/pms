// @vitest-environment happy-dom
/** Mounted acceptance for the real WP0 shell, Settings and register filters. */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = {
  hasPermission: (_permission: string) => true,
  isOwner: true,
  status: "authenticated" as const,
  companyName: "Acme Builders Sdn Bhd",
  tenantCode: "ACME-SECRET-CONTEXT",
  email: "owner@acme.test",
  displayName: "Private Owner Name",
  projectHubRole: "owner",
  roleLabel: "Owner / Admin",
  roleStatus: "owner",
  permissions: [],
  refreshSession: () => {},
  error: null,
  signIn: () => {},
  signOut: vi.fn(),
};

vi.mock("@/lib/n3-session", () => ({
  useSession: () => sessionState,
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

let latestProjectParams: Record<string, unknown> | null = null;
let latestRoleSearch = "";
const projectQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: { rows: [], total: 0 },
  refetch: vi.fn(),
};
const roleQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: { entries: [], n3DirectoryAvailable: true },
  refetch: vi.fn(),
};

vi.mock("@/lib/projecthub-hooks", () => ({
  useProjects: (params: Record<string, unknown>) => {
    latestProjectParams = params;
    return projectQuery;
  },
  useRoleDirectory: (search: string) => {
    latestRoleSearch = search;
    return roleQuery;
  },
  useAssignRole: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

const verificationQuery = {
  isPending: false,
  isError: false,
  error: null,
  data: { rows: [], total: 0, clientSide: true },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => verificationQuery,
}));

import { AppShell } from "@/components/AppShell";
import { resetDisplayWidthMemory } from "@/lib/display-preference";

function componentOf(route: unknown): ComponentType {
  return (route as { options: { component: ComponentType } }).options.component;
}

beforeEach(() => {
  window.localStorage.clear();
  resetDisplayWidthMemory();
  latestProjectParams = null;
  latestRoleSearch = "";
  sessionState.hasPermission = () => true;
  sessionState.isOwner = true;
  sessionState.status = "authenticated";
  sessionState.roleStatus = "owner";
});

afterEach(() => cleanup());

describe("compact real application shell", () => {
  it("renders exactly Dashboard, Projects and Settings without private identity details", () => {
    const { container } = render(
      <AppShell>
        <p>Mounted content</p>
      </AppShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Dashboard", "Projects", "Settings"]);
    expect(container.textContent).toContain("Acme Builders Sdn Bhd");
    expect(container.textContent).not.toContain("ACME-SECRET-CONTEXT");
    expect(container.textContent).not.toContain("owner@acme.test");
    expect(container.textContent).not.toContain("Private Owner Name");
  });

  it("keeps Settings reachable while permission-filtering navigation and modules", async () => {
    sessionState.isOwner = false;
    sessionState.roleStatus = "assigned";
    sessionState.hasPermission = (permission: string) => permission === "projecthub:roles:manage";
    const { Route } = await import("@/routes/settings");
    const SettingsRoute = componentOf(Route);
    render(<SettingsRoute />);

    expect(screen.queryByRole("link", { name: "Projects" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Team & Roles/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /N3 Data Verification/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Capability Inventory/ })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Desktop display width" })).toBeTruthy();
  });
});

describe("mounted clear controls", () => {
  it("restores every visible Settings module after a filtered search", async () => {
    const user = userEvent.setup();
    const { Route } = await import("@/routes/settings");
    const SettingsRoute = componentOf(Route);
    render(<SettingsRoute />);

    const input = screen.getByRole("searchbox", { name: "Search settings modules" });
    await user.type(input, "team");
    expect(screen.getByRole("link", { name: /Team & Roles/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Capability Inventory/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(input).toHaveValue("");
    expect(screen.getByRole("link", { name: /Capability Inventory/ })).toBeTruthy();
  });

  it("resets the project register search, status, type and page inputs together", async () => {
    const user = userEvent.setup();
    const { Route } = await import("@/routes/projects.index");
    const ProjectsRoute = componentOf(Route);
    render(<ProjectsRoute />);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "clubhouse");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "in_progress");
    await user.selectOptions(screen.getByRole("combobox", { name: "Project type" }), "renovation");
    expect(latestProjectParams).toMatchObject({
      search: "clubhouse",
      status: "in_progress",
      projectType: "renovation",
      page: 0,
    });

    const clear = screen.getByRole("button", { name: "Clear filters" });
    await user.click(clear);
    await waitFor(() =>
      expect(latestProjectParams).toMatchObject({
        search: "",
        status: "",
        projectType: "",
        page: 0,
      }),
    );
    expect(clear).toBeDisabled();
  });

  it("clears the role-directory search and disables itself again", async () => {
    const user = userEvent.setup();
    const { Route } = await import("@/routes/roles");
    const RolesRoute = componentOf(Route);
    render(<RolesRoute />);

    const input = screen.getByRole("searchbox", { name: "Search N3 users" });
    await user.type(input, "estimator");
    expect(latestRoleSearch).toBe("estimator");
    const clear = screen.getByRole("button", { name: "Clear search" });
    await user.click(clear);
    expect(input).toHaveValue("");
    expect(latestRoleSearch).toBe("");
    expect(clear).toBeDisabled();
  });

  it("clears verification search text and committed filter state", async () => {
    const user = userEvent.setup();
    const { Route } = await import("@/routes/verification");
    const VerificationRoute = componentOf(Route);
    render(<VerificationRoute />);

    const input = screen.getByRole("textbox", { name: "Search code or name" });
    await user.type(input, "PRJ-001");
    await user.click(screen.getByRole("button", { name: "Search" }));
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    expect(input).toHaveValue("");
    expect(clear).toBeDisabled();
  });
});
