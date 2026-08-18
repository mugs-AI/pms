import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const quotationServer = readFileSync("src/lib/projecthub-quotation.server.ts", "utf8");
const quotationPanel = readFileSync("src/components/projecthub/QuotationPanel.tsx", "utf8");
const api = readFileSync("src/lib/projecthub-api.server.ts", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const settings = readFileSync("src/routes/settings.tsx", "utf8");
const shell = readFileSync("src/components/AppShell.tsx", "utf8");
const dashboard = readFileSync("src/routes/index.tsx", "utf8");
const enquiry = readFileSync("src/routes/projects.new.tsx", "utf8");
const ui = readFileSync("src/components/projecthub/ui.tsx", "utf8");

describe("quotation preview is strictly read-only", () => {
  it("never writes, posts or mutates through the quotation service", () => {
    for (const forbidden of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(quotationServer).not.toContain(forbidden);
    }
  });

  it("exposes the preview only through a GET route", () => {
    expect(api).toContain('child === "quotation-preview"');
    expect(api).toContain("getQuotationPreview");
  });

  it("marks the document as not posted to N3", () => {
    expect(quotationServer).toContain('postingState: "not_posted"');
    expect(quotationPanel).toContain("notPostedToN3Label");
  });

  it("separates preview blockers from future-posting blockers", () => {
    expect(quotationServer).toContain('scope !== "future_posting"');
    expect(quotationPanel).toContain('b.scope === "preview"');
    expect(quotationPanel).toContain('b.scope === "future_posting"');
  });

  it("never renders internal cost, margin or supplier data", () => {
    // Ignore the file's own doc comment; only rendered code must be clean.
    const code = quotationPanel.replace(/\/\*\*[\s\S]*?\*\//g, "").toLowerCase();
    for (const forbidden of ["cost", "margin", "supplier", "n3customer", "tenant"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("A4 print contract", () => {
  it("defines an A4 page and hides app chrome when printing", () => {
    expect(styles).toContain("size: A4 portrait");
    expect(styles).toContain("@media print");
    expect(styles).toContain(".quotation-sheet");
    expect(styles).toContain("display: none !important");
  });

  it("keeps the print trigger itself out of the printed sheet", () => {
    expect(quotationPanel).toContain("print:hidden");
    expect(quotationPanel).toContain("window.print()");
    expect(quotationPanel).toContain("quotation-sheet");
  });
});

describe("compact shell and settings", () => {
  it("keeps the top navigation to three entries", () => {
    expect(shell).toContain('{ to: "/", label: "Dashboard" }');
    expect(shell).toContain('label: "Projects"');
    expect(shell).toContain('{ to: "/settings", label: "Settings" }');
    expect(shell).not.toContain('label: "Team & Roles"');
    expect(shell).not.toContain('label: "Capability Inventory"');
  });

  it("permission-filters every settings module", () => {
    expect(settings).toContain('hasPermission("projecthub:roles:manage")');
    expect(settings).toContain("visible: isOwner");
    expect(settings).toContain("No settings available");
  });

  it("drops raw session diagnostics from the dashboard", () => {
    for (const forbidden of ["Tenant code", "Signed-in user", "From CompanyProfile/BasicInfo"]) {
      expect(dashboard).not.toContain(forbidden);
    }
  });
});

describe("usability and accessibility contracts", () => {
  it("gives the enquiry form focus-managed validation and one cancel action", () => {
    expect(enquiry).toContain("function reject(");
    expect(enquiry).toContain("fields.current[field]?.focus()");
    expect(enquiry).toContain('"aria-invalid": true');
    expect(enquiry.match(/Cancel/g)?.length ?? 0).toBe(1);
  });

  it("implements the N3 picker as a keyboard-complete combobox", () => {
    for (const token of [
      'role="combobox"',
      'role="listbox"',
      'role="option"',
      "aria-activedescendant",
      '"ArrowDown"',
      '"Escape"',
      '"Home"',
    ]) {
      expect(ui).toContain(token);
    }
  });

  it("respects reduced motion for loading skeletons", () => {
    expect(ui).toContain("motion-safe:animate-pulse");
  });
});
