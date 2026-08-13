/**
 * Layout + UX Polish 1 — display-width preference regression tests.
 * Presentation only: no tenant, token, user, role or identity data is involved.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DISPLAY_WIDTH,
  DISPLAY_WIDTH_KEY,
  isDisplayWidth,
  readDisplayWidth,
  subscribeDisplayWidth,
  widthContainerClass,
  writeDisplayWidth,
} from "@/lib/display-preference";

class MemoryStorage {
  store = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;
  getItem(key: string) {
    if (this.throwOnGet) throw new Error("blocked");
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.throwOnSet) throw new Error("quota exceeded");
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  const bus = new EventTarget();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.assign(globalThis, {
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
    dispatchEvent: bus.dispatchEvent.bind(bus),
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "addEventListener");
  Reflect.deleteProperty(globalThis, "removeEventListener");
  Reflect.deleteProperty(globalThis, "dispatchEvent");
});

describe("display width preference", () => {
  it("defaults to standard", () => {
    expect(DEFAULT_DISPLAY_WIDTH).toBe("standard");
    expect(readDisplayWidth()).toBe("standard");
  });

  it("accepts only standard and full", () => {
    expect(isDisplayWidth("standard")).toBe(true);
    expect(isDisplayWidth("full")).toBe(true);
    for (const value of ["wide", "", null, undefined, 1, {}]) {
      expect(isDisplayWidth(value)).toBe(false);
    }
  });

  it("falls back to standard for invalid stored values", () => {
    storage.store.set(DISPLAY_WIDTH_KEY, "gigantic");
    expect(readDisplayWidth()).toBe("standard");
  });

  it("falls back to standard when storage is unavailable or throws", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(readDisplayWidth()).toBe("standard");
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    storage.throwOnGet = true;
    expect(readDisplayWidth()).toBe("standard");
  });

  it("persists the selection under projecthub:display-width", () => {
    writeDisplayWidth("full");
    expect(DISPLAY_WIDTH_KEY).toBe("projecthub:display-width");
    expect(storage.store.get(DISPLAY_WIDTH_KEY)).toBe("full");
    expect(readDisplayWidth()).toBe("full");
  });

  it("survives a quota failure without throwing", () => {
    storage.throwOnSet = true;
    expect(() => writeDisplayWidth("full")).not.toThrow();
    expect(readDisplayWidth()).toBe("standard");
  });

  it("notifies same-tab consumers immediately", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayWidth(listener);
    writeDisplayWidth("full");
    expect(listener).toHaveBeenCalled();
    expect(readDisplayWidth()).toBe("full");
    unsubscribe();
  });

  it("notifies consumers from a cross-tab storage event", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayWidth(listener);
    const event = new Event("storage") as Event & { key?: string };
    event.key = DISPLAY_WIDTH_KEY;
    globalThis.dispatchEvent(event);
    expect(listener).toHaveBeenCalledTimes(1);
    const unrelated = new Event("storage") as Event & { key?: string };
    unrelated.key = "some:other:key";
    globalThis.dispatchEvent(unrelated);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    subscribeDisplayWidth(listener)();
    writeDisplayWidth("full");
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the accepted standard container width", () => {
    const cls = widthContainerClass("standard");
    expect(cls).toContain("max-w-6xl");
    expect(cls).toContain("mx-auto");
    expect(cls).not.toContain("max-w-none");
  });

  it("uses the full browser workspace with safe padding in full mode", () => {
    const cls = widthContainerClass("full");
    expect(cls).toContain("w-full");
    expect(cls).toContain("max-w-none");
    expect(cls).toContain("px-4");
    expect(cls).toContain("sm:px-6");
    expect(cls).toContain("lg:px-8");
  });

  it("never persists tenant, token, user, role or identity data", () => {
    writeDisplayWidth("full");
    expect([...storage.store.keys()]).toEqual([DISPLAY_WIDTH_KEY]);
    expect([...storage.store.values()]).toEqual(["full"]);
    const source = readFileSync("src/lib/display-preference.ts", "utf8");
    for (const forbidden of ["fetch(", "supabase", "projectHubRequest", "n3Get", "useSession"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("shell and route responsive contracts", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");

  it("renders the toggle with radiogroup semantics and tooltips", () => {
    expect(shell).toContain('role="radiogroup"');
    expect(shell).toContain('role="radio"');
    expect(shell).toContain("aria-checked={checked}");
    expect(shell).toContain("Centered layout, capped for readability");
    expect(shell).toContain("Use the full browser workspace");
  });

  it("applies one shared container to header, navigation and main", () => {
    expect(shell).toContain("widthContainerClass(width)");
    expect(shell.match(/\{container\}|\$\{container\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(shell).not.toContain("mx-auto max-w-6xl px-4");
  });

  it("keeps navigation permission-driven and closes the mobile menu on navigation", () => {
    expect(shell).toContain("session.hasPermission(item.permission)");
    expect(shell).toContain("session.isOwner");
    expect(shell).toContain("onClick={() => setOpen(false)}");
    expect(shell).toContain("aria-expanded={open}");
  });

  it("exposes a skip link and a dynamic-viewport shell", () => {
    expect(shell).toContain("Skip to main content");
    expect(shell).toContain('id="main-content"');
    expect(shell).toContain("min-h-dvh");
  });

  it("wraps dense tables in a contained horizontal scroller", () => {
    for (const file of ["src/routes/verification.tsx", "src/routes/capabilities.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("overflow-x-auto");
      expect(source).toContain("min-w-[");
      expect(source).toContain("<caption");
    }
  });

  it("stacks key forms and filters at phone widths", () => {
    const projects = readFileSync("src/routes/projects.index.tsx", "utf8");
    expect(projects).toContain("grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3");
    const enquiry = readFileSync("src/routes/projects.new.tsx", "utf8");
    expect(enquiry).toContain("sm:grid-cols-2");
    expect(enquiry).not.toMatch(/grid-cols-2(?!\s|")/);
  });
});
