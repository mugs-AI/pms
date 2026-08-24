/**
 * P1-N3-CUST-01 — mounted browser behavior.
 *
 *  - Verification customers tab reads through GET /api/projecthub/n3/customers
 *    (same server-controlled adapter as the business picker), never
 *    /api/public/n3 directly.
 *  - Explicit loading / error / empty / completeness states; reliable totals
 *    are shown, missing totals show the explicit completeness note instead of
 *    a fabricated number; pagination is explicit.
 *  - New Enquiry N3Picker shows the completeness hint when the server's
 *    one-row probe reports more matches than the bounded page.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../src/lib/api-client", () => ({ apiFetch }));

const { n3Get } = vi.hoisted(() => ({ n3Get: vi.fn() }));
vi.mock("../src/lib/n3-client", () => ({
  n3Get,
  unwrapPageList: (b: unknown) => b,
  describeError: (e: unknown) => ({
    status: null,
    message: e instanceof Error ? e.message : String(e),
  }),
}));

import { routeTree } from "../src/routeTree.gen";
import { SessionContext } from "../src/lib/n3-session";
import { OwnerEnquiryForm } from "../src/components/projecthub/forms";

const OWNER = {
  isOwner: true,
  tenantCode: "TENANT-1",
  companyCode: "TENANT-1",
  email: "owner@example.com",
  userName: "Owner User",
  source: "dev-api-key",
  roles: ["sys-admin"],
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function mountAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <SessionContext.Provider value={OWNER as never}>{children}</SessionContext.Provider>
      </QueryClientProvider>
    ),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.queryByText("Checking N3 session…")).toBeNull());
  return router;
}

/** Queue ok responses for every projecthub API call the page makes. */
function stubPageApis() {
  apiFetch.mockImplementation((input: string | URL) => {
    const url = String(input);
    if (url.startsWith("/api/projecthub/session")) {
      return Promise.resolve(jsonResponse(200, { data: { status: "provisioned" } }));
    }
    if (url.includes("/api/projecthub/n3/customers")) {
      return Promise.resolve(
        jsonResponse(200, {
          data: {
            options: [
              { id: "a", code: "C001", name: "Acme Builders", detail: "010 555 0101", rate: null },
              { id: "b", code: "C002", name: "Bayside Holdings", detail: null, rate: null },
            ],
            total: 2,
            hasMore: false,
          },
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `unstubbed: ${url}` }));
  });
}

afterEach(() => cleanup());

describe("P1-N3-CUST-01 verification customers tab", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    n3Get.mockReset();
    stubPageApis();
  });

  it("loads customers through the server adapter with loading then rows", async () => {
    await mountAt("/verification");
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(screen.getByText("Loading from N3…")).toBeInTheDocument();
    expect(await screen.findByText("Acme Builders")).toBeInTheDocument();
    expect(screen.getByText("C001")).toBeInTheDocument();
    const urls = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/api/projecthub/n3/customers"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/public/n3"))).toBe(false);
    expect(n3Get).not.toHaveBeenCalled();
    // Reliable total displayed, no completeness warning.
    expect(screen.getByText(/2 records/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends the normalized search and resets paging", async () => {
    await mountAt("/verification");
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    await screen.findByText("Acme Builders");
    fireEvent.change(screen.getByLabelText("Search code or name"), {
      target: { value: "Bayside" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      const calls = apiFetch.mock.calls.map((c) => String(c[0]));
      expect(
        calls.some((u) => u.startsWith("/api/projecthub/n3/customers") && u.includes("Bayside")),
      ).toBe(true);
    });
  });

  it("shows the explicit empty state when N3 returns no customers", async () => {
    apiFetch.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projecthub/session")) {
        return Promise.resolve(jsonResponse(200, { data: { status: "provisioned" } }));
      }
      if (url.includes("/api/projecthub/n3/customers")) {
        return Promise.resolve(
          jsonResponse(200, { data: { options: [], total: 0, hasMore: false } }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: `unstubbed: ${url}` }));
    });
    await mountAt("/verification");
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(
      await screen.findByText("No customers returned by N3 for this query."),
    ).toBeInTheDocument();
  });

  it("shows the completeness state instead of a fabricated total when the count is missing", async () => {
    apiFetch.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projecthub/session")) {
        return Promise.resolve(jsonResponse(200, { data: { status: "provisioned" } }));
      }
      if (url.includes("/api/projecthub/n3/customers")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              options: [
                { id: "a", code: "C001", name: "Acme Builders", detail: null, rate: null },
              ],
              total: null,
              hasMore: true,
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: `unstubbed: ${url}` }));
    });
    await mountAt("/verification");
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(await screen.findByText("Acme Builders")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("may be incomplete");
    expect(screen.getByText(/total unknown/)).toBeInTheDocument();
    // Next stays enabled because the probe says more results exist.
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("shows the error state when the adapter rejects", async () => {
    apiFetch.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projecthub/session")) {
        return Promise.resolve(jsonResponse(200, { data: { status: "provisioned" } }));
      }
      if (url.includes("/api/projecthub/n3/customers")) {
        return Promise.resolve(jsonResponse(403, { error: "Owner role required" }));
      }
      return Promise.resolve(jsonResponse(404, { error: `unstubbed: ${url}` }));
    });
    await mountAt("/verification");
    fireEvent.click(screen.getByRole("tab", { name: "Customers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Owner role required");
  });
});

describe("P1-N3-CUST-01 picker completeness hint", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("shows the refine hint when the server probe reports more matches", async () => {
    apiFetch.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.startsWith("/api/projecthub/session")) {
        return Promise.resolve(jsonResponse(200, { data: { status: "provisioned" } }));
      }
      if (url.includes("/api/projecthub/n3/customers")) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              options: [
                { id: "a", code: "C001", name: "Acme Builders", detail: null, rate: null },
              ],
              total: null,
              hasMore: true,
            },
          }),
        );
      }
      if (url.includes("/api/projecthub/n3/currencies")) {
        return Promise.resolve(
          jsonResponse(200, { data: { options: [], total: 0, hasMore: false } }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: `unstubbed: ${url}` }));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerEnquiryForm />
      </QueryClientProvider>,
    );
    // Open the customer combobox listbox.
    fireEvent.focus(screen.getByRole("combobox", { name: /customer/i }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: /customer/i }), { key: "ArrowDown" });
    const hint = await screen.findByText(/refine your search/i);
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toContain("first 1 matches");
  });
});
