// @vitest-environment happy-dom
/**
 * P1-N3-CUST-01 — mounted browser behavior.
 *
 *  - Verification customers tab reads through the server-controlled adapter
 *    (`projectHubRequest("n3/customers")`), never the browser N3 client.
 *  - Explicit loading / error / empty / completeness states; reliable totals
 *    are shown, missing totals show the explicit completeness note instead of
 *    a fabricated number; pagination is explicit.
 *  - The N3Picker shows the completeness hint when the server's one-row probe
 *    reports more matches than the bounded page.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = {
  hasPermission: (_p: string) => true,
  isOwner: true,
  status: "authenticated" as const,
  companyName: "Acme Builders Sdn Bhd",
  tenantCode: null,
  email: null,
  displayName: null,
  projectHubRole: "owner",
  roleLabel: "Owner",
  roleStatus: "assigned",
  permissions: [],
  refreshSession: () => {},
  error: null,
  signIn: () => {},
  signOut: () => {},
};

vi.mock("@/lib/n3-session", () => ({
  useSession: () => sessionState,
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

// The browser N3 client must never be used by the customers surface.
const { n3Get } = vi.hoisted(() => ({ n3Get: vi.fn() }));
vi.mock("@/lib/n3-client", () => ({
  n3Get,
  unwrapPageList: (b: unknown) => (b as { data?: { value?: unknown[] } })?.data?.value ?? [],
}));

// Server-adapter requests are intercepted here; the picker hook is doubled so
// the combobox hint can be driven without a query client round-trip.
const { projectHubRequest, pickerQuery } = vi.hoisted(() => ({
  projectHubRequest: vi.fn(),
  pickerQuery: {
    isLoading: false,
    isError: false,
    error: null,
    data: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock("@/lib/projecthub-client", () => ({
  projectHubRequest,
  describeError: (e: unknown) => ({
    message: e instanceof Error ? e.message : String(e),
    correlationId: null,
  }),
}));

vi.mock("@/lib/projecthub-hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projecthub-hooks")>();
  return { ...actual, useN3Picker: () => pickerQuery };
});

import { Route as VerificationRoute } from "@/routes/verification";
import { N3Picker } from "@/components/projecthub/ui";

const VerificationPage = (
  VerificationRoute as unknown as { options: { component: () => React.JSX.Element } }
).options.component;

const PAGE = {
  options: [
    { id: "a", code: "C001", name: "Acme Builders", detail: "010 555 0101", rate: null },
    { id: "b", code: "C002", name: "Bayside Holdings", detail: null, rate: null },
  ],
  total: 2 as number | null,
  hasMore: false,
  completeness: "complete" as "complete" | "incomplete",
  reason: null as string | null,
};

function renderVerification() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VerificationPage />
    </QueryClientProvider>,
  );
}

function requestedUrls() {
  return projectHubRequest.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  projectHubRequest.mockReset();
  n3Get.mockReset();
  pickerQuery.isLoading = false;
  pickerQuery.isError = false;
  pickerQuery.data = null;
});
afterEach(() => cleanup());

describe("verification customers tab", () => {
  it("loads through the server adapter with loading then rows and a reliable total", async () => {
    projectHubRequest.mockResolvedValue(PAGE);
    renderVerification();
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(screen.getByText(/Loading from N3/)).toBeTruthy();
    expect(await screen.findByText("Acme Builders")).toBeTruthy();
    expect(screen.getByText("C001")).toBeTruthy();
    expect(requestedUrls().some((u) => u === "master/customers")).toBe(true);
    // No customer read went through the browser N3 client.
    expect(n3Get.mock.calls.some(([path]) => String(path).includes("Customers"))).toBe(false);
    expect(screen.getByText(/2 records/)).toBeTruthy();
    expect(screen.queryByText(/Search incomplete/)).toBeNull();
  });

  it("sends the normalized search term and resets paging", async () => {
    projectHubRequest.mockResolvedValue(PAGE);
    renderVerification();
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    await screen.findByText("Acme Builders");
    fireEvent.change(screen.getByLabelText("Search code or name"), {
      target: { value: "Bayside" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      const searchCalls = projectHubRequest.mock.calls.filter(
        (c) =>
          String(c[0]) === "master/customers" &&
          (c[1] as { query?: { search?: string } })?.query?.search === "Bayside",
      );
      expect(searchCalls.length).toBeGreaterThan(0);
      expect((searchCalls[0]![1] as { query: { page: number } }).query.page).toBe(0);
    });
  });

  it("shows the explicit empty state when N3 returns no customers", async () => {
    projectHubRequest.mockResolvedValue({
      options: [],
      total: 0,
      hasMore: false,
      completeness: "complete",
      reason: null,
    });
    renderVerification();
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(await screen.findByText("No matching N3 records.")).toBeTruthy();
  });

  it("shows the completeness state instead of a fabricated total when the count is missing", async () => {
    projectHubRequest.mockResolvedValue({
      options: [PAGE.options[0]],
      total: null,
      hasMore: true,
      completeness: "incomplete",
      reason: "page_budget",
    });
    renderVerification();
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(await screen.findByText("Acme Builders")).toBeTruthy();
    expect(screen.getByText(/Search incomplete/)).toBeTruthy();
    expect(screen.getByText(/total unknown/)).toBeTruthy();
    // Next stays enabled because the server probe says more results exist.
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows the error state when the adapter rejects", async () => {
    projectHubRequest.mockRejectedValue(new Error("Owner role required"));
    renderVerification();
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Owner role required");
  });
});

describe("picker completeness hint", () => {
  it("shows the refine hint when the server probe reports more matches", async () => {
    pickerQuery.data = {
      options: [{ id: "a", code: "C001", name: "Acme Builders", detail: null, rate: null }],
      total: null,
      hasMore: true,
    };
    render(<N3Picker label="N3 customer" kind="customers" value={null} onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: /customer/i });
    fireEvent.focus(input);
    const hint = await screen.findByText(/refine your search/i);
    expect(hint.textContent).toContain("first 1 matches");
  });

  it("omits the hint when the page is complete", async () => {
    pickerQuery.data = {
      options: [{ id: "a", code: "C001", name: "Acme Builders", detail: null, rate: null }],
      total: 1,
      hasMore: false,
    };
    render(<N3Picker label="N3 customer" kind="customers" value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByRole("combobox", { name: /customer/i }));
    await screen.findByText(/Acme Builders/);
    expect(screen.queryByText(/refine your search/i)).toBeNull();
  });
});
