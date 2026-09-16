import { useSyncExternalStore } from "react";

export type FontSize = "small" | "standard" | "large";

export const FONT_SIZE_KEY = "projecthub:font-size";
export const FONT_SIZE_EVENT = "projecthub:font-size-change";
export const DEFAULT_FONT_SIZE: FontSize = "standard";

let memoryFontSize: FontSize | null = null;

export function isFontSize(value: unknown): value is FontSize {
  return value === "small" || value === "standard" || value === "large";
}

export function resetFontSizeMemory(): void {
  memoryFontSize = null;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readFontSize(): FontSize {
  if (memoryFontSize) return memoryFontSize;
  try {
    const value = storage()?.getItem(FONT_SIZE_KEY);
    return isFontSize(value) ? value : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function writeFontSize(value: FontSize): void {
  if (!isFontSize(value)) return;
  memoryFontSize = value;
  try {
    storage()?.setItem(FONT_SIZE_KEY, value);
  } catch {
    // The in-memory value still applies when persistence is unavailable.
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(FONT_SIZE_EVENT, { detail: value }));
  } catch {
    // Environments without CustomEvent skip same-tab notification.
  }
}

export function subscribeFontSize(onChange: () => void): () => void {
  const target = globalThis as unknown as EventTarget & { addEventListener?: unknown };
  if (typeof target.addEventListener !== "function") return () => {};
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === undefined || key === FONT_SIZE_KEY) {
      memoryFontSize = null;
      onChange();
    }
  };
  target.addEventListener("storage", onStorage);
  target.addEventListener(FONT_SIZE_EVENT, onChange);
  return () => {
    target.removeEventListener("storage", onStorage);
    target.removeEventListener(FONT_SIZE_EVENT, onChange);
  };
}

export function useFontSize(): [FontSize, (value: FontSize) => void] {
  const value = useSyncExternalStore(subscribeFontSize, readFontSize, () => DEFAULT_FONT_SIZE);
  return [value, writeFontSize];
}

export function fontSizeClass(value: FontSize): string {
  return `font-size-${value}`;
}
