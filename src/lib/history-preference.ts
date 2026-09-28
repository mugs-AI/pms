/**
 * Browser-only History grid column preference, per scope. Stores ONLY an
 * allowlisted, sanitised list of column keys — never filters, rows, tenant,
 * user, token or identity data — and is never sent to any API except as the
 * export column selection chosen on screen.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_COLUMNS,
  sanitiseColumnSelection,
  type HistoryColumnKey,
  type HistoryScope,
} from "./projecthub-history";

export const historyColumnsKey = (scope: HistoryScope) => `projecthub:history-columns:${scope}`;
export const HISTORY_COLUMNS_EVENT = "projecthub:history-columns-change";

const memory: Partial<Record<HistoryScope, HistoryColumnKey[]>> = {};
const cache: Partial<Record<HistoryScope, { raw: string | null; value: HistoryColumnKey[] }>> = {};

export function resetHistoryColumnsMemory(): void {
  delete memory.project;
  delete memory.global;
  delete cache.project;
  delete cache.global;
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readHistoryColumns(scope: HistoryScope): HistoryColumnKey[] {
  const mem = memory[scope];
  if (mem) return mem;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(historyColumnsKey(scope)) ?? null;
  } catch {
    raw = null;
  }
  const cached = cache[scope];
  if (cached && cached.raw === raw) return cached.value;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const value = sanitiseColumnSelection(parsed ?? DEFAULT_COLUMNS[scope], scope);
  cache[scope] = { raw, value };
  return value;
}

export function writeHistoryColumns(scope: HistoryScope, columns: HistoryColumnKey[] | null): void {
  const value = sanitiseColumnSelection(columns ?? DEFAULT_COLUMNS[scope], scope);
  memory[scope] = value;
  try {
    const store = storage();
    if (columns === null) store?.removeItem(historyColumnsKey(scope));
    else store?.setItem(historyColumnsKey(scope), JSON.stringify(value));
  } catch {
    // Blocked or over quota: the in-memory value still applies in this tab.
  }
  try {
    window.dispatchEvent(new CustomEvent(HISTORY_COLUMNS_EVENT, { detail: scope }));
  } catch {
    /* non-browser */
  }
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith("projecthub:history-columns:")) {
      const scope = e.key.split(":").pop() as HistoryScope;
      delete memory[scope];
      callback();
    }
  };
  window.addEventListener(HISTORY_COLUMNS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(HISTORY_COLUMNS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHistoryColumns(scope: HistoryScope) {
  const columns = useSyncExternalStore(
    subscribe,
    () => readHistoryColumns(scope),
    () => DEFAULT_COLUMNS[scope],
  );
  const setColumns = useCallback(
    (next: HistoryColumnKey[] | null) => writeHistoryColumns(scope, next),
    [scope],
  );
  return [columns, setColumns] as const;
}
