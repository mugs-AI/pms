// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FontSizeControl } from "@/components/projecthub/FontSizeControl";
import {
  applyRootFontSize,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_EVENT,
  FONT_SIZE_KEY,
  readFontSize,
  resetFontSizeMemory,
  subscribeFontSize,
  writeFontSize,
} from "@/lib/font-preference";
import {
  canOpenProjectWorkspace,
  clearWorkspaceTabs,
  consumeApprovedDiscardNavigation,
  discardNewEnquiry,
  getWorkspaceCapMessage,
  getWorkspaceTabs,
  isOrdinarySameTabActivation,
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

  it("uses a Standard server-safe default and applies one allowlisted root class", () => {
    expect(DEFAULT_FONT_SIZE).toBe("standard");
    const root = document.documentElement;
    const cleanupRoot = applyRootFontSize("small", root);
    expect(root.classList.contains("font-size-small")).toBe(true);
    applyRootFontSize("large", root);
    expect(root.classList.contains("font-size-small")).toBe(false);
    expect(root.classList.contains("font-size-large")).toBe(true);
    cleanupRoot();
    root.classList.remove("font-size-large");
  });

  it("updates same-tab subscribers and accepts cross-tab storage changes", () => {
    let changes = 0;
    const unsubscribe = subscribeFontSize(() => {
      changes += 1;
    });
    writeFontSize("large");
    expect(changes).toBe(1);
    expect(readFontSize()).toBe("large");
    window.localStorage.setItem(FONT_SIZE_KEY, "small");
    window.dispatchEvent(new StorageEvent("storage", { key: FONT_SIZE_KEY }));
    expect(changes).toBe(2);
    expect(readFontSize()).toBe("small");
    unsubscribe();
    window.dispatchEvent(new CustomEvent(FONT_SIZE_EVENT));
    expect(changes).toBe(2);
  });

  it("falls back in memory when browser storage is blocked", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    writeFontSize("small");
    expect(readFontSize()).toBe("small");
    if (original) Object.defineProperty(globalThis, "localStorage", original);
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

  it("uses one capacity decision for ordinary same-tab activation only", () => {
    for (let index = 1; index <= 8; index += 1) {
      openProjectWorkspace({
        projectId: `p${index}`,
        reference: `ENQ-${index}`,
        title: `Project ${index}`,
        section: "overview",
      });
    }
    expect(canOpenProjectWorkspace("p1")).toBe(true);
    expect(canOpenProjectWorkspace("p9")).toBe(false);
    expect(
      isOrdinarySameTabActivation({
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isOrdinarySameTabActivation({
        button: 0,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(false);
  });

  it("keeps New Enquiry optional and converts a successful ninth save without exceeding eight", () => {
    for (let index = 1; index <= 8; index += 1) {
      openProjectWorkspace({
        projectId: `p${index}`,
        reference: `ENQ-${index}`,
        title: `Project ${index}`,
        section: "overview",
      });
    }
    openNewEnquiryWorkspace();
    expect(getWorkspaceTabs()).toHaveLength(9);
    replaceNewEnquiryWithProject({
      projectId: "p9",
      reference: "ENQ-9",
      title: "Project 9",
      section: "overview",
    });
    expect(getWorkspaceTabs().filter((tab) => tab.projectId)).toHaveLength(8);
    expect(getWorkspaceTabs().some((tab) => tab.projectId === "p9")).toBe(true);
    expect(getWorkspaceTabs().some((tab) => tab.projectId === "p1")).toBe(false);
  });

  it("asks once for a dirty discard and consumes one approved follow-up navigation", () => {
    openNewEnquiryWorkspace();
    setNewEnquiryDirty(true);
    let confirmations = 0;
    expect(
      discardNewEnquiry(() => {
        confirmations += 1;
        return true;
      }, true),
    ).toBe(true);
    expect(confirmations).toBe(1);
    expect(consumeApprovedDiscardNavigation()).toBe(true);
    expect(consumeApprovedDiscardNavigation()).toBe(false);
  });

  it("preserves a dirty enquiry when discard is declined", () => {
    openNewEnquiryWorkspace();
    setNewEnquiryDirty(true);
    expect(discardNewEnquiry(() => false, true)).toBe(false);
    expect(getWorkspaceTabs().some((tab) => tab.key === "new-enquiry")).toBe(true);
    expect(consumeApprovedDiscardNavigation()).toBe(false);
  });
});
