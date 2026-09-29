import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useHistoryColumns } from "@/lib/history-preference";
import { downloadProjectHubFile, describeError, projectHubRequest } from "@/lib/projecthub-client";
import { formatMalaysianDateTime } from "@/lib/projecthub-date";
import {
  cellText,
  HISTORY_COLUMN_BY_KEY,
  HISTORY_COLUMNS,
  HISTORY_PAGE_SIZES,
  HISTORY_TEXT_MAX,
  isRequiredColumn,
  type HistoryColumnKey,
  type HistoryPage,
  type HistoryRow,
  type HistoryScope,
  type HistorySortKey,
} from "@/lib/projecthub-history";
import { ErrorState, inputClass, Skeleton } from "./ui";

type Props = {
  scope: HistoryScope;
  projectId?: string;
  canExport: boolean;
  /** Accessible name for the grid. */
  label: string;
};

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

/** Debounces free-text filters so typing does not fire a request per key. */
function useDebounced<T>(value: T, ms = 350): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

export function HistoryGrid({ scope, projectId, canExport, label }: Props) {
  const [columns, setColumns] = useHistoryColumns(scope);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const debounced = useDebounced(draft);
  const [sortKey, setSortKey] = useState<HistorySortKey>("occurredAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState<number>(50);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Only valid, complete filter values are sent; half-typed dates are held back.
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(debounced)) {
      const value = v.trim();
      if (!value) continue;
      if ((k === "dateFrom" || k === "dateTo") && !DATE_RE.test(value)) continue;
      out[k] = value.slice(0, HISTORY_TEXT_MAX);
    }
    return out;
  }, [debounced]);

  const filterKey = JSON.stringify([filters, sortKey, sortDirection, limit]);
  useEffect(() => {
    setCursors([null]);
    setExpanded(null);
  }, [filterKey]);

  const cursor = cursors[cursors.length - 1] ?? null;
  const path = scope === "global" ? "history" : `projects/${projectId}/history`;
  const baseQuery = { ...filters, sortKey, sortDirection };

  const query = useQuery({
    queryKey: ["projecthub", "history", scope, projectId ?? null, filterKey, cursor],
    queryFn: () =>
      projectHubRequest<HistoryPage>(path, {
        query: { ...baseQuery, limit, cursor: cursor ?? undefined },
      }),
    placeholderData: keepPreviousData,
  });

  const setFilter = (param: string, value: string) => setDraft((d) => ({ ...d, [param]: value }));
  const activeFilters = Object.values(draft).some((v) => v.trim());

  function toggleSort(key: HistorySortKey) {
    if (sortKey === key) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection(key === "occurredAt" ? "desc" : "asc");
    }
  }

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadProjectHubFile(
        `${path}/export.xlsx`,
        { ...baseQuery, columns: columns.join(",") },
        scope === "global" ? "global-history.xlsx" : "project-history.xlsx",
      );
    } catch (error) {
      setExportError(describeError(error).message);
    } finally {
      setExporting(false);
    }
  }

  function move(key: HistoryColumnKey, delta: number) {
    const i = columns.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j] as HistoryColumnKey, next[i] as HistoryColumnKey];
    setColumns(next);
  }

  function toggleColumn(key: HistoryColumnKey) {
    if (isRequiredColumn(key, scope)) return;
    setColumns(columns.includes(key) ? columns.filter((c) => c !== key) : [...columns, key]);
  }

  const rows = query.data?.rows ?? [];
  const pageNumber = cursors.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setChooserOpen((o) => !o)}
          aria-expanded={chooserOpen}
          aria-controls={`history-columns-${scope}`}
          className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
        >
          Columns
        </button>
        {activeFilters ? (
          <button
            type="button"
            onClick={() => setDraft({})}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            Clear filters
          </button>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Rows
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            {HISTORY_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {canExport ? (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        ) : null}
      </div>
      {exportError ? (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      ) : null}

      {chooserOpen ? (
        <div
          id={`history-columns-${scope}`}
          className="rounded-md border border-border bg-card p-3"
          role="group"
          aria-label="Choose and order columns"
        >
          <ul className="grid gap-1 sm:grid-cols-2">
            {[
              ...columns,
              ...HISTORY_COLUMNS.map((c) => c.key).filter((k) => !columns.includes(k)),
            ].map((key) => {
              const col = HISTORY_COLUMN_BY_KEY[key];
              const shown = columns.includes(key);
              const required = isRequiredColumn(key, scope);
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <input
                    id={`col-${scope}-${key}`}
                    type="checkbox"
                    checked={shown}
                    disabled={required}
                    onChange={() => toggleColumn(key)}
                  />
                  <label htmlFor={`col-${scope}-${key}`} className="flex-1">
                    {col.label}
                    {required ? <span className="text-muted-foreground"> (required)</span> : null}
                  </label>
                  {shown ? (
                    <>
                      <button
                        type="button"
                        aria-label={`Move ${col.label} left`}
                        onClick={() => move(key, -1)}
                        className="rounded px-1.5 hover:bg-secondary"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${col.label} right`}
                        onClick={() => move(key, 1)}
                        className="rounded px-1.5 hover:bg-secondary"
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setColumns(null)}
            className="mt-3 rounded-md border border-input px-3 py-1 text-sm hover:bg-secondary"
          >
            Restore default columns
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-max text-sm" aria-label={label}>
          <thead className="bg-secondary/60 text-left">
            <tr>
              <th scope="col" className="w-8 px-2 py-2">
                <span className="sr-only">Details</span>
              </th>
              {columns.map((key) => {
                const col = HISTORY_COLUMN_BY_KEY[key];
                const sortable = col.sortKey;
                const active = sortable && sortKey === sortable;
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      active ? (sortDirection === "asc" ? "ascending" : "descending") : undefined
                    }
                    className="px-2 py-2 font-semibold whitespace-nowrap"
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(sortable)}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {col.label}
                        <span aria-hidden="true">
                          {active ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
            <tr>
              <td />
              {columns.map((key) => (
                <td key={key} className="px-2 pb-2">
                  <FilterCell columnKey={key} draft={draft} onChange={setFilter} />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.isError ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-3">
                  <ErrorState error={query.error} onRetry={() => void query.refetch()} />
                </td>
              </tr>
            ) : query.isPending ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-3">
                  <Skeleton rows={3} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-6 text-center text-muted-foreground">
                  {activeFilters ? "No history matches these filters." : "No history recorded yet."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Fragment key={row.eventId}>
                  <tr className="border-t border-border align-top hover:bg-secondary/30">
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        aria-expanded={expanded === row.eventId}
                        aria-label={`Details for ${row.title}`}
                        onClick={() => setExpanded((e) => (e === row.eventId ? null : row.eventId))}
                        className="rounded px-1 hover:bg-secondary"
                      >
                        {expanded === row.eventId ? "−" : "+"}
                      </button>
                    </td>
                    {columns.map((key) => (
                      <td key={key} className="max-w-[28rem] px-2 py-1.5">
                        {renderCell(row, key)}
                      </td>
                    ))}
                  </tr>
                  {expanded === row.eventId ? (
                    <tr className="bg-secondary/20">
                      <td />
                      <td colSpan={columns.length} className="px-2 py-2">
                        <RowDetails row={row} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="History pages" className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">Page {pageNumber}</span>
        <button
          type="button"
          disabled={cursors.length <= 1}
          onClick={() => setCursors((c) => c.slice(0, -1))}
          className="rounded-md border border-input px-3 py-1 hover:bg-secondary disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!query.data?.nextCursor || query.isFetching}
          onClick={() => {
            const next = query.data?.nextCursor;
            if (next) setCursors((c) => [...c, next]);
          }}
          className="rounded-md border border-input px-3 py-1 hover:bg-secondary disabled:opacity-50"
        >
          Next
        </button>
      </nav>
    </div>
  );
}

function renderCell(row: HistoryRow, key: HistoryColumnKey) {
  if (key === "occurredAt") {
    return <span className="whitespace-nowrap">{formatMalaysianDateTime(row.occurredAt)}</span>;
  }
  if (key === "title") {
    return (
      <span>
        {row.title}
        {row.legacyDerived ? (
          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
            Legacy
          </span>
        ) : null}
      </span>
    );
  }
  if (key === "outcome") {
    const tone =
      row.outcome === "succeeded"
        ? "text-foreground"
        : row.outcome === "failed" || row.outcome === "rejected"
          ? "text-destructive"
          : "text-muted-foreground";
    return <span className={`capitalize ${tone}`}>{row.outcome.replace(/_/g, " ")}</span>;
  }
  const text = cellText(row, key);
  return text ? (
    <span className="break-words">{text}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function FilterCell({
  columnKey,
  draft,
  onChange,
}: {
  columnKey: HistoryColumnKey;
  draft: Record<string, string>;
  onChange: (param: string, value: string) => void;
}) {
  const col = HISTORY_COLUMN_BY_KEY[columnKey];
  const filter = col.filter;
  if (!filter) return null;
  const small = `${inputClass} py-1 text-xs`;
  const name = `Filter ${col.label}`;
  if (filter.kind === "date") {
    return (
      <div className="flex gap-1">
        <input
          aria-label="From date (DD/MM/YYYY)"
          placeholder="From DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          value={draft["dateFrom"] ?? ""}
          onChange={(e) => onChange("dateFrom", e.target.value)}
          className={`${small} w-28`}
        />
        <input
          aria-label="To date (DD/MM/YYYY)"
          placeholder="To DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          value={draft["dateTo"] ?? ""}
          onChange={(e) => onChange("dateTo", e.target.value)}
          className={`${small} w-28`}
        />
      </div>
    );
  }
  const param = filter.param;
  if (filter.kind === "enum" || filter.kind === "boolean") {
    const options = filter.kind === "boolean" ? ["true", "false"] : [...(filter.options ?? [])];
    return (
      <select
        aria-label={name}
        value={draft[param] ?? ""}
        onChange={(e) => onChange(param, e.target.value)}
        className={small}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "true" ? "Yes" : o === "false" ? "No" : o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={name}
      placeholder={filter.kind === "uuid" ? "Full ID" : "Contains…"}
      maxLength={filter.kind === "uuid" ? 36 : HISTORY_TEXT_MAX}
      value={draft[param] ?? ""}
      onChange={(e) => onChange(param, e.target.value)}
      className={small}
    />
  );
}

function RowDetails({ row }: { row: HistoryRow }) {
  const entries = (obj: Record<string, unknown> | null) =>
    obj
      ? Object.entries(obj).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      : [];
  const before = entries(row.details.before);
  const after = entries(row.details.after);
  return (
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      <div>
        <dt className="font-semibold">Event type</dt>
        <dd>{row.eventType}</dd>
      </div>
      <div>
        <dt className="font-semibold">Recorded</dt>
        <dd>{formatMalaysianDateTime(row.recordedAt ?? row.occurredAt)}</dd>
      </div>
      {row.changedFields.length ? (
        <div>
          <dt className="font-semibold">Changed fields</dt>
          <dd>{row.changedFields.join(", ")}</dd>
        </div>
      ) : null}
      {row.reason ? (
        <div>
          <dt className="font-semibold">Reason</dt>
          <dd>{row.reason}</dd>
        </div>
      ) : null}
      {before.length ? (
        <div>
          <dt className="font-semibold">Before</dt>
          <dd>{before.join("; ")}</dd>
        </div>
      ) : null}
      {after.length ? (
        <div>
          <dt className="font-semibold">After</dt>
          <dd>{after.join("; ")}</dd>
        </div>
      ) : null}
      <div>
        <dt className="font-semibold">Support reference</dt>
        <dd className="font-mono">{row.correlationId}</dd>
      </div>
      {row.legacyDerived ? (
        <p className="text-muted-foreground sm:col-span-2">
          Recorded before detailed history; some labels are derived from current data.
        </p>
      ) : null}
    </dl>
  );
}
