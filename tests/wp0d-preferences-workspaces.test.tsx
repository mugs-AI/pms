// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FontSizeControl } from "@/components/projecthub/FontSizeControl";
import { FONT_SIZE_KEY, resetFontSizeMemory } from "@/lib/font-preference";
import {
  clearWorkspaceTabs,
  getWorkspaceCapMessage,
  getWorkspaceTabs,
  normaliseSection,
  openNewEnquiryWorkspace,
  openProjectWorkspace,
  replaceNewEnquiryWithProject,
  setNewEnquiryDirty,
} from "@/lib/workspace-tabs";

beforeEach(() => {
  window.localStorage.clear();
  resetFontSizeMemory();
  clearWorkspaceTabs();
});

afterEach(cleanup);

describe("WP0D font preference", () => {
  it("uses Standard by default and persists closed-set keyboard choices", async () => {
    render(<FontSizeControl />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Small", "Standard", "Large"]);
    expect(radios[1]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios[1] as HTMLElement, { key: "End" });
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[2]?.getAttribute("aria-checked")).toBe("true"),
    );
    expect(window.localStorage.getItem(FONT_SIZE_KEY)).toBe("large");
  });
});

describe("WP0D in-memory workspace model", () => {
  it("deduplicates projects, tracks dirty New Enquiry, and replaces it after save", () => {
    openNewEnquiryWorkspace();
    setNewEnquiryDirty(true);
    openProjectWorkspace({ projectId: "p1", reference: "ENQ-1", title: "One", section: "phases" });
    openProjectWorkspace({ projectId: "p1", reference: "ENQ-1", title: "One", section: "budget" });
    expect(getWorkspaceTabs()).toHaveLength(2);
    expect(getWorkspaceTabs().find((tab) => tab.key === "new-enquiry")?.dirty).toBe(true);
    expect(getWorkspaceTabs().find((tab) => tab.projectId === "p1")?.section).toBe("budget");

    replaceNewEnquiryWithProject({
      projectId: "p2",
      reference: "ENQ-2",
      title: "Two",
      section: "overview",
    });
    expect(getWorkspaceTabs().some((tab) => tab.key === "new-enquiry")).toBe(false);
    expect(getWorkspaceTabs().map((tab) => tab.projectId)).toEqual(["p1", "p2"]);
  });

  it("caps projects at eight and safely normalises URL sections", () => {
    for (let index = 1; index <= 8; index += 1) {
      expect(
        openProjectWorkspace({
          projectId: `p${index}`,
          reference: `ENQ-${index}`,
          title: `Project ${index}`,
          section: "overview",
        }),
      ).toBe(true);
    }
    expect(
      openProjectWorkspace({
        projectId: "p9",
        reference: "ENQ-9",
        title: "Project 9",
        section: "overview",
      }),
    ).toBe(false);
    expect(getWorkspaceTabs()).toHaveLength(8);
    expect(getWorkspaceCapMessage()).toContain("Up to 8 projects");
    expect(normaliseSection("quotation")).toBe("quotation");
    expect(normaliseSection("unsafe-section")).toBe("overview");
  });
});
