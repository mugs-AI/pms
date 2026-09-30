// @vitest-environment happy-dom
/** Mounted acceptance for the real WP0E HistoryGrid and Global History route. */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPage, HistoryRow } from "@/lib/projecthub-history";

const request = vi.fn();
const download = vi.fn();
vi.mock("@/lib/projecthub-client", () => ({
  projectHubRequest: (...a: unknown[]) => request(...a),
  downloadProjectHubFile: (...a: unknown[]) => download(...a),
  describeError: (e: unknown) => ({
    message: e instanceof Error ? e.message : "Error",
    correlationId: null,
  }),
}));

const session = {
  isOwner: true,
  hasPermission: (_p: string) => true,
};
vi.mock("@/lib/n3-session", () => ({
  useSession: () => session,
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import { HistoryGrid } from "@/components/projecthub/HistoryGrid";
import { resetHistoryColumnsMemory } from "@/lib/history-preference";

const PID = "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b";

function row(n: number, extra: Partial<HistoryRow> = {}): HistoryRow {
  return {
    eventId: `00000000-0000-4000-8000-00000000000${n}`,
    projectId: PID,
    occurredAt: "2026-09-01T02:05:00.000Z",
    recordedAt: null,
    user: "Aina",
    title: `Event ${n}`,
    project: "Clubhouse",
    projectReference: "ENQ-2026-00001",
    module: "project",
    action: "updated",
    outcome: "succeeded",
    phase: null,
    eventType: "project.updated",
    entityType: null,
    entityReference: null,
    entityTitle: null,
    source: "ProjectHub",
    reason: null,
    documentType: null,
    documentNumber: null,
    changedFields: ["title"],
    correlationId: "c",
    legacyDerived: false,
    details: { before: { title: "Old" }, after: { title: "New" } },
    ...extra,
  };
}

function page(rows: HistoryRow[], nextCursor: string | null = null): HistoryPage {
  return { rows, nextCursor, pageSize: 50, total: null, appliedFilters: [] };
}

function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const lastQuery = () =>
  (request.mock.calls.at(-1) as [string, { query: Record<string, unknown> }])[1].query;

beforeEach(() => {
  localStorage.clear();
  resetHistoryColumnsMemory();
  request.mockReset().mockResolvedValue(page([row(1)]));
  download.mockReset().mockResolvedValue(undefined);
  session.isOwner = true;
  session.hasPermission = () => true;
});
afterEach(() => cleanup());

describe("mounted HistoryGrid", () => {
  it("renders Malaysian dates, legacy tag and row details from the project endpoint", async () => {
    request.mockResolvedValue(page([row(1, { legacyDerived: true, reason: "Client asked" })]));
    const user = userEvent.setup();
    mount(<HistoryGrid scope="project" projectId={PID} canExport={false} label="History" />);
    expect(await screen.findByText("01/09/2026 10:05")).toBeInTheDocument();
    expect(request.mock.calls[0]?.[0]).toBe(`projects/${PID}/history`);
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Details for Event 1" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("project.updated")).toBeInTheDocument();
    expect(screen.getByText("Client asked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export to Excel" })).toBeNull();
  });

  it("shows loading, empty and error states", async () => {
    let resolve: (p: HistoryPage) => void = () => {};
    request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = mount(<HistoryGrid scope="global" canExport label="G" />);
    expect(screen.queryByText("No history recorded yet.")).toBeNull();
    await act(async () => resolve(page([])));
    expect(await screen.findByText("No history recorded yet.")).toBeInTheDocument();
    unmount();
    request.mockRejectedValue(new Error("Denied by server"));
    mount(<HistoryGrid scope="global" canExport label="G" />);
    expect(await screen.findByText(/Denied by server/)).toBeInTheDocument();
  });

  it("submits and clears per-column filters, holding back incomplete dates", async () => {
    const user = userEvent.setup();
    mount(<HistoryGrid scope="global" canExport label="G" />);
    await screen.findByText("Event 1");
    await user.type(screen.getByRole("textbox", { name: "Filter Title" }), "roof");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter Outcome" }), "failed");
    await user.type(screen.getByRole("textbox", { name: "From date (DD/MM/YYYY)" }), "01/09");
    await waitFor(() => expect(lastQuery()).toMatchObject({ title: "roof", outcome: "failed" }));
    expect(lastQuery()).not.toHaveProperty("dateFrom");
    await user.type(screen.getByRole("textbox", { name: "From date (DD/MM/YYYY)" }), "/2026");
    await waitFor(() => expect(lastQuery()).toMatchObject({ dateFrom: "01/09/2026" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty("title"));
    expect(lastQuery()).not.toHaveProperty("outcome");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("changes sort and page size and walks cursors forward and back", async () => {
    request.mockImplementation(async (_p: string, o: { query: { cursor?: string } }) =>
      o.query.cursor === "c2" ? page([row(2)]) : page([row(1)], "c2"),
    );
    const user = userEvent.setup();
    mount(<HistoryGrid scope="global" canExport label="G" />);
    await screen.findByText("Event 1");
    expect(lastQuery()).toMatchObject({ sortKey: "occurredAt", sortDirection: "desc", limit: 50 });
    await user.click(screen.getByRole("button", { name: /Title/ }));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ sortKey: "title", sortDirection: "asc" }),
    );
    expect(screen.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Rows" }), "20");
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 20 }));
    const nav = screen.getByRole("navigation", { name: "History pages" });
    await user.click(within(nav).getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Event 2")).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ cursor: "c2" });
    expect(within(nav).getByText("Page 2")).toBeInTheDocument();
    await user.click(within(nav).getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Event 1")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("hides, reorders and restores columns, persisting only keys, and keeps required ones", async () => {
    const user = userEvent.setup();
    mount(<HistoryGrid scope="global" canExport label="G" />);
    await screen.findByText("Event 1");
    const chooserBtn = screen.getByRole("button", { name: "Columns" });
    await user.click(chooserBtn);
    expect(chooserBtn).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Choose and order columns" });
    expect(within(group).getByRole("checkbox", { name: "Title (required)" })).toBeDisabled();
    await user.click(within(group).getByRole("checkbox", { name: "User" }));
    await user.click(within(group).getByRole("button", { name: "Move Title left" }));
    const headers = () =>
      screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/[▲▼↕]/g, ""));
    expect(headers()).toEqual([
      "Details",
      "Title",
      "Date & Time",
      "Project",
      "Module",
      "Action",
      "Outcome",
    ]);
    expect(JSON.parse(localStorage.getItem("projecthub:history-columns:global") ?? "[]")).toEqual([
      "title",
      "occurredAt",
      "project",
      "module",
      "action",
      "outcome",
    ]);
    await user.click(screen.getByRole("button", { name: "Export to Excel" }));
    expect(download).toHaveBeenCalledWith(
      "history/export.xlsx",
      expect.objectContaining({
        columns: "title,occurredAt,project,module,action,outcome",
        sortKey: "occurredAt",
      }),
      "global-history.xlsx",
    );
    await user.click(within(group).getByRole("button", { name: "Restore default columns" }));
    expect(headers()).toEqual([
      "Details",
      "Date & Time",
      "User",
      "Title",
      "Project",
      "Module",
      "Action",
      "Outcome",
    ]);
  });

  it("still works when browser storage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const user = userEvent.setup();
    mount(<HistoryGrid scope="project" projectId={PID} canExport label="P" />);
    await screen.findByText("Event 1");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(screen.getByRole("checkbox", { name: "User" }));
    expect(screen.queryByRole("columnheader", { name: "User" })).toBeNull();
    spy.mockRestore();
  });

  it("sends active filters to the project export route and reports export failure", async () => {
    download.mockRejectedValue(new Error("More than 50,000 rows"));
    const user = userEvent.setup();
    mount(<HistoryGrid scope="project" projectId={PID} canExport label="P" />);
    await screen.findByText("Event 1");
    await user.type(screen.getByRole("textbox", { name: "Filter User" }), "aina");
    await waitFor(() => expect(lastQuery()).toMatchObject({ actor: "aina" }));
    await user.click(screen.getByRole("button", { name: "Export to Excel" }));
    expect(download).toHaveBeenCalledWith(
      `projects/${PID}/history/export.xlsx`,
      expect.objectContaining({
        actor: "aina",
        columns: "occurredAt,user,title,module,action,outcome",
      }),
      "project-history.xlsx",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("More than 50,000 rows");
  });
});

describe("mounted Global History route", () => {
  async function GlobalRoute() {
    const { Route } = await import("@/routes/settings_.history");
    return (Route as unknown as { options: { component: ComponentType } }).options.component;
  }

  it("mounts the global grid with export for the Owner", async () => {
    const Page = await GlobalRoute();
    mount(<Page />);
    expect(
      await screen.findByRole("table", { name: "Global ProjectHub history" }),
    ).toBeInTheDocument();
    expect(request.mock.calls[0]?.[0]).toBe("history");
    expect(screen.getByRole("button", { name: "Export to Excel" })).toBeInTheDocument();
  });

  it("denies assigned non-Owners and unassigned users without calling the API", async () => {
    const Page = await GlobalRoute();
    session.isOwner = false;
    const { unmount } = mount(<Page />);
    expect(screen.getByText("Owner access required")).toBeInTheDocument();
    unmount();
    session.hasPermission = () => false;
    mount(<Page />);
    expect(screen.getByText("Owner access required")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});
