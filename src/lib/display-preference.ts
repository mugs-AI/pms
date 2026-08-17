/**
 * Browser-only desktop display-width preference (UI convenience only).
 *
 * Never stores tenant, user, token, role or identity data, and is never sent
 * to any API. Server render and first client render always use Standard so
 * hydration cannot mismatch; the stored preference is adopted after mount.
 */
import { useSyncExternalStore } from "react";

export type DisplayWidth = "standard" | "full";

export const DISPLAY_WIDTH_KEY = "projecthub:display-width";
export const DEFAULT_DISPLAY_WIDTH: DisplayWidth = "standard";

/** Same-tab notification channel; the `storage` event only fires cross-tab. */
export const DISPLAY_WIDTH_EVENT = "projecthub:display-width-change";

export function isDisplayWidth(value: unknown): value is DisplayWidth {
  return value === "standard" || value === "full";
}

/**
 * Current-tab fallback. When localStorage is missing, blocked or over quota
 * the selection must still apply immediately, so the chosen width is kept in
 * memory. It holds only the safe UI preference — never tenant, token, user,
 * email, role or identity data.
 */
let memoryWidth: DisplayWidth | null = null;

/** Test-only reset of the in-memory fallback. */
export function resetDisplayWidthMemory(): void {
  memoryWidth = null;
}

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    // Privacy mode / blocked storage.
    return null;
  }
}

export function readDisplayWidth(): DisplayWidth {
  if (memoryWidth) return memoryWidth;
  const store = storage();
  if (!store) return DEFAULT_DISPLAY_WIDTH;
  try {
    const raw = store.getItem(DISPLAY_WIDTH_KEY);
    return isDisplayWidth(raw) ? raw : DEFAULT_DISPLAY_WIDTH;
  } catch {
    return DEFAULT_DISPLAY_WIDTH;
  }
}

export function writeDisplayWidth(value: DisplayWidth): void {
  if (!isDisplayWidth(value)) return;
  // Applies in the current tab even when persistence is impossible.
  memoryWidth = value;
  const store = storage();
  if (store) {
    try {
      store.setItem(DISPLAY_WIDTH_KEY, value);
    } catch {
      // Quota or blocked storage: keep the in-memory selection only.
    }
  }
  const target = (globalThis as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent
    ? (globalThis as unknown as EventTarget)
    : null;
  try {
    target?.dispatchEvent(new CustomEvent(DISPLAY_WIDTH_EVENT, { detail: value }));
  } catch {
    // Environments without CustomEvent simply skip same-tab notification.
  }
}

/** Subscribes to same-tab and cross-tab preference changes. */
export function subscribeDisplayWidth(onChange: () => void): () => void {
  const target = globalThis as unknown as EventTarget & {
    addEventListener?: unknown;
  };
  if (typeof target.addEventListener !== "function") return () => {};
  const handleStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === undefined || key === DISPLAY_WIDTH_KEY) {
      // Another tab is now the source of truth: drop the local override.
      memoryWidth = null;
      onChange();
    }
  };
  target.addEventListener("storage", handleStorage);
  target.addEventListener(DISPLAY_WIDTH_EVENT, onChange);
  return () => {
    target.removeEventListener("storage", handleStorage);
    target.removeEventListener(DISPLAY_WIDTH_EVENT, onChange);
  };
}

export function useDisplayWidth(): [DisplayWidth, (value: DisplayWidth) => void] {
  const width = useSyncExternalStore(
    subscribeDisplayWidth,
    readDisplayWidth,
    () => DEFAULT_DISPLAY_WIDTH,
  );
  return [width, writeDisplayWidth];
}

/**
 * Single source of truth for the shared page container.
 * Both modes are fluid below the Standard maximum and always full width on
 * small screens; only the desktop cap differs.
 */
export function widthContainerClass(width: DisplayWidth): string {
  const padding = "px-4 sm:px-6 lg:px-8";
  return width === "full" ? `w-full max-w-none ${padding}` : `mx-auto w-full max-w-6xl ${padding}`;
}
