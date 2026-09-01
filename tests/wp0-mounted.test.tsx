// @vitest-environment happy-dom
/**
 * Mounted behavioural acceptance for WP0.
 *
 * These tests render real components and drive them with keyboard and pointer
 * input. Source-string scans elsewhere remain supplementary only.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = {
  hasPermission: (_p: string) => true,
  isOwner: true,
  status: "authenticated" as const,
  companyName: null,
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
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: "project-1" }),
  }),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

const quotationQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: null as unknown,
  refetch: vi.fn(),
};
const workspaceQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: null as unknown,
  refetch: vi.fn(),
};
const pickerQuery = {
  isLoading: false,
  isError: false,
  error: null,
  data: { options: [] as unknown[] } as Record<string, unknown> | null,
  refetch: vi.fn(),
};
const masterQuery = {
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
  data: null as Record<string, unknown> | null,
  refetch: vi.fn(),
};
const masterCalls: string[] = [];

vi.mock("@/lib/projecthub-hooks", () => ({
  useQuotationPreview: (_id: string, enabled: boolean) => ({ ...quotationQuery, enabled }),
  useProjectWorkspace: () => workspaceQuery,
  useN3Picker: () => pickerQuery,
  useN3MasterPage: (kind: string) => {
    masterCalls.push(`master/${kind}`);
    return masterQuery;
  },
  useBoq: () => ({ isLoading: false, isError: false, data: null, refetch: vi.fn() }),
  useProjectMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));


import { DisplayWidthControl } from "@/components/projecthub/DisplayWidthControl";
import { QuotationPanel } from "@/components/projecthub/QuotationPanel";
import { N3Picker } from "@/components/projecthub/ui";

beforeEach(() => {
  window.localStorage.clear();
  sessionState.hasPermission = () => true;
});
afterEach(() => cleanup());

describe("display width radiogroup (mounted)", () => {
  it("exposes a labelled radiogroup with roving tab order", () => {
    render(<DisplayWidthControl />);
    const group = screen.getByRole("radiogroup", { name: "Desktop display width" });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[0]!.getAttribute("tabindex")).toBe("0");
    expect(radios[1]!.getAttribute("tabindex")).toBe("-1");
  });

  it("selects the next option with ArrowRight and moves focus", async () => {
    render(<DisplayWidthControl />);
    const radios = screen.getAllByRole("radio");
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[1]!.getAttribute("aria-checked")).toBe("true"),
    );
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[1]);
  });

  it("wraps with Home/End and persists only the safe preference", async () => {
    render(<DisplayWidthControl />);
    fireEvent.keyDown(screen.getAllByRole("radio")[0]!, { key: "End" });
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[1]!.getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.keyDown(screen.getAllByRole("radio")[1]!, { key: "Home" });
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[0]!.getAttribute("aria-checked")).toBe("true"),
    );
    const stored = JSON.stringify(window.localStorage);
    expect(stored).not.toMatch(/token|bearer|email|tenant/i);
  });
});

describe("quotation panel (mounted)", () => {
  it("denies the panel when the actor cannot view BOQ data", () => {
    render(<QuotationPanel projectId="p1" canView={false} />);
    expect(screen.getByText("No quotation access")).toBeTruthy();
  });

  it("renders readiness blockers and no document when the preview is blocked", () => {
    quotationQuery.data = {
      quotation: {
        previewGeneratedAt: new Date().toISOString(),
        postingState: "not_posted",
        notPostedToN3Label: "Not posted to N3",
        previewReady: false,
        futurePostingReady: false,
        blockers: [
          { code: "boq_not_ready_for_review", scope: "preview", message: "Still a draft." },
          {
            code: "n3_customer_not_linked",
            scope: "future_posting",
            message: "Customer not linked.",
          },
        ],
        document: null,
      },
    };
    render(<QuotationPanel projectId="p1" canView />);
    expect(screen.getByText("Preview blocked")).toBeTruthy();
    expect(screen.getByText("Blocking the preview")).toBeTruthy();
    expect(screen.getByText("Blocking a future N3 posting")).toBeTruthy();
    expect(screen.getAllByText("Not posted to N3").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Print/ })).toBeNull();
  });

  it("prints a document whose header survives print chrome hiding", () => {
    quotationQuery.data = {
      quotation: {
        previewGeneratedAt: new Date().toISOString(),
        postingState: "not_posted",
        notPostedToN3Label: "Not posted to N3",
        previewReady: true,
        futurePostingReady: true,
        blockers: [],
        document: {
          enquiryReference: "ENQ-2026-00001",
          projectTitle: "Clubhouse renovation",
          customerDisplayName: "Acme Sdn Bhd",
          siteDescription: "1 Jalan Satu",
          revisionLabel: "Rev A",
          primaryPhaseName: "Main contract",
          currency: "MYR",
          sections: [
            {
              code: "A",
              name: "Preliminaries",
              lines: [
                {
                  lineNumber: 1,
                  description: "Site setup",
                  quantity: "1.0000",
                  uom: "LOT",
                  sellingRate: "1000.00",
                  sellingAmount: "1000.00",
                  taxCode: null,
                  taxRate: null,
                  taxAmount: "0.00",
                  amountWithTax: "1000.00",
                },
              ],
              subtotal: { selling: "1000.00", tax: "0.00", total: "1000.00" },
            },
          ],
          totals: { selling: "1000.00", tax: "0.00", total: "1000.00" },
        },
      },
    };
    const printSpy = vi.fn();
    Object.defineProperty(window, "print", { value: printSpy, writable: true });
    const { container } = render(<QuotationPanel projectId="p1" canView />);

    const sheet = container.querySelector(".quotation-sheet") as HTMLElement;
    expect(sheet).toBeTruthy();
    const docHeader = sheet.querySelector("header") as HTMLElement;
    expect(docHeader).toBeTruthy();
    // The customer-facing header must never be inside print-hidden chrome.
    expect(docHeader.className).not.toContain("print:hidden");
    expect(docHeader.textContent).toContain("ENQ-2026-00001");
    expect(docHeader.textContent).toContain("Acme Sdn Bhd");
    expect(docHeader.textContent).toContain("Not posted to N3");
    // The readiness/control chrome around it is print-hidden.
    expect(container.querySelectorAll(".print\\:hidden").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Print/ }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Clubhouse renovation")).toBeTruthy();
    expect(screen.getAllByText("1000.00", { selector: "td" }).length).toBeGreaterThan(0);
  });
});

describe("N3 combobox (mounted keyboard)", () => {
  it("opens on ArrowDown, moves the active option and selects with Enter", async () => {
    pickerQuery.data = {
      options: [
        { id: "1", code: "C1", name: "Customer One", label: "C1 — Customer One" },
        { id: "2", code: "C2", name: "Customer Two", label: "C2 — Customer Two" },
      ],
    };
    const onChange = vi.fn();
    render(<N3Picker kind="customers" label="Customer" value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("true"));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(2));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true"),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
  });

  it("closes on Escape without selecting", async () => {
    const onChange = vi.fn();
    render(<N3Picker kind="customers" label="Customer" value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(input.getAttribute("aria-expanded")).toBe("false"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("new enquiry validation (mounted)", () => {
  it("blocks submit, marks the field invalid and focuses it when the title is empty", async () => {
    const { Route } = await import("@/routes/projects.new");
    const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
      .component;
    const { container } = render(<Component />);
    const form = container.querySelector("form") as HTMLFormElement;
    // Native validation must not pre-empt the accessible custom path.
    expect(form.hasAttribute("novalidate")).toBe(true);
    const title = screen.getByRole("textbox", { name: /Project title/i }) as HTMLInputElement;
    expect(title.hasAttribute("required")).toBe(false);
    expect(title.getAttribute("aria-required")).toBe("true");

    fireEvent.submit(form);
    await waitFor(() => expect(title.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getAllByText("A project title is required.").length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(title);
  });

  it("clears the invalid state once a title is supplied", async () => {
    const user = userEvent.setup();
    const { Route } = await import("@/routes/projects.new");
    const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
      .component;
    const { container } = render(<Component />);
    const form = container.querySelector("form") as HTMLFormElement;
    const title = screen.getByRole("textbox", { name: /Project title/i }) as HTMLInputElement;
    fireEvent.submit(form);
    await waitFor(() => expect(title.getAttribute("aria-invalid")).toBe("true"));
    await user.type(title, "Clubhouse renovation");
    fireEvent.submit(form);
    await waitFor(() => expect(title.getAttribute("aria-invalid")).not.toBe("true"));
  });
});

describe("project workspace quotation tab permission (mounted)", () => {
  async function renderWorkspace() {
    workspaceQuery.data = {
      workspace: {
        project: {
          id: "project-1",
          title: "Clubhouse renovation",
          enquiry_reference: "ENQ-2026-00001",
          project_type: "renovation",
          status: "enquiry",
          budget_mode: "detailed_boq",
        },
        phases: [],
        team: [],
        events: [],
        boq: null,
        capabilities: { canEdit: true, canCancel: true, canManageTeam: true, canEditBoq: true },
      },
    };
    const mod = await import("@/routes/projects.$projectId");
    const Component = (mod.Route as unknown as { options: { component: React.ComponentType } })
      .options.component;
    return render(<Component />);
  }

  it("hides the Quotation tab from a role without projecthub:boq:view", async () => {
    sessionState.hasPermission = (p: string) => p === "projecthub:projects:list";
    await renderWorkspace();
    expect(screen.queryByRole("button", { name: "Quotation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
  });

  it("shows the Quotation tab to a role with projecthub:boq:view", async () => {
    sessionState.hasPermission = (p: string) =>
      p === "projecthub:projects:list" || p === "projecthub:boq:view";
    quotationQuery.data = null;
    await renderWorkspace();
    const tab = screen.getByRole("button", { name: "Quotation" });
    fireEvent.click(tab);
    await waitFor(() => expect(screen.getByText("No quotation data")).toBeTruthy());
  });
});
