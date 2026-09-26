/**
 * Browser-safe ProjectHub History contract (WP0E).
 *
 * Column definitions, enum allowlists, legacy event-type derivation, query
 * parsing and value sanitisation shared by the server read model, the XLSX
 * export and the HistoryGrid UI. Contains no secrets and no tenant data; the
 * server remains the only authority for scope and permissions.
 */
import { displayDateToIso } from "./projecthub-date";

export const HISTORY_MODULES = [
  "Enquiry",
  "Project",
  "Phase",
  "Team",
  "Budget",
  "BOQ",
  "Quotation",
  "Document",
  "Procurement",
  "Stock",
  "Claim",
  "Billing",
  "Receipt",
  "Finance",
  "Closeout",
  "System",
] as const;
export type HistoryModule = (typeof HISTORY_MODULES)[number];

export const HISTORY_ACTIONS = [
  "created",
  "updated",
  "cancelled",
  "assigned",
  "deactivated",
  "cloned",
  "linked",
  "recorded",
  "approved",
  "rejected",
  "reversed",
  "exported",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const HISTORY_OUTCOMES = [
  "succeeded",
  "failed",
  "rejected",
  "reversed",
  "informational",
] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];

export const HISTORY_SOURCES = ["ProjectHub", "N3", "Google Drive"] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

export const HISTORY_ACTOR_TYPES = ["human", "system", "scheduled_job", "integration"] as const;

/**
 * Every event type ProjectHub has ever written, with its module/action. Used
 * to label legacy rows (written before WP0E) and to translate module/action
 * filters so legacy rows are matched exactly on the server.
 */
export const KNOWN_EVENT_TYPES: Record<string, { module: HistoryModule; action: HistoryAction }> =
  {
    "project.enquiry_created": { module: "Enquiry", action: "created" },
    "project.customer_linked": { module: "Enquiry", action: "linked" },
    "project.customer_request_recorded": { module: "Enquiry", action: "recorded" },
    "project.project_code_linked": { module: "Phase", action: "linked" },
    "project.project_code_request_recorded": { module: "Phase", action: "recorded" },
    "project.updated": { module: "Project", action: "updated" },
    "project.cancelled": { module: "Project", action: "cancelled" },
    "phase.created": { module: "Phase", action: "created" },
    "phase.updated": { module: "Phase", action: "updated" },
    "team.assigned": { module: "Team", action: "assigned" },
    "team.deactivated": { module: "Team", action: "deactivated" },
    "boq.version_created": { module: "BOQ", action: "created" },
    "boq.version_cloned": { module: "BOQ", action: "cloned" },
    "boq.version_updated": { module: "BOQ", action: "updated" },
    "boq.section_created": { module: "BOQ", action: "created" },
    "boq.item_created": { module: "BOQ", action: "created" },
    "boq.item_updated": { module: "BOQ", action: "updated" },
  };

/** Module/action for an event type; unknown types fall back to System/recorded. */
export function deriveModuleAction(eventType: string): {
  module: HistoryModule;
  action: HistoryAction;
} {
  const known = KNOWN_EVENT_TYPES[eventType];
  if (known) return known;
  const prefix = eventType.split(".")[0] ?? "";
  const byPrefix: Record<string, HistoryModule> = {
    project: "Project",
    phase: "Phase",
    team: "Team",
    boq: "BOQ",
    quotation: "Quotation",
    budget: "Budget",
  };
  const suffix = eventType.split(/[._]/).pop() ?? "";
  const action = (HISTORY_ACTIONS as readonly string[]).includes(suffix)
    ? (suffix as HistoryAction)
    : "recorded";
  return { module: byPrefix[prefix] ?? "System", action };
}

export function legacyEventTypesForModule(module: string): string[] {
  return Object.entries(KNOWN_EVENT_TYPES)
    .filter(([, v]) => v.module === module)
    .map(([k]) => k);
}
export function legacyEventTypesForAction(action: string): string[] {
  return Object.entries(KNOWN_EVENT_TYPES)
    .filter(([, v]) => v.action === action)
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type HistoryScope = "project" | "global";
export type FilterKind = "text" | "enum" | "date" | "uuid" | "boolean";

export type HistoryColumn = {
  key: HistoryColumnKey;
  label: string;
  /** Query parameter used for this column's filter. */
  filter: { param: string; kind: FilterKind; options?: readonly string[] } | null;
  sortKey?: HistorySortKey;
  requiredIn: readonly HistoryScope[];
};

export const HISTORY_COLUMN_KEYS = [
  "occurredAt",
  "user",
  "title",
  "project",
  "projectReference",
  "module",
  "action",
  "outcome",
  "phase",
  "eventType",
  "entityType",
  "entityReference",
  "entityTitle",
  "source",
  "reason",
  "documentType",
  "documentNumber",
  "changedFields",
  "correlationId",
  "eventId",
  "legacyDerived",
] as const;
export type HistoryColumnKey = (typeof HISTORY_COLUMN_KEYS)[number];

export const HISTORY_SORT_KEYS = ["occurredAt", "title", "eventType"] as const;
export type HistorySortKey = (typeof HISTORY_SORT_KEYS)[number];

export const HISTORY_COLUMNS: readonly HistoryColumn[] = [
  {
    key: "occurredAt",
    label: "Date & Time",
    filter: { param: "date", kind: "date" },
    sortKey: "occurredAt",
    requiredIn: ["project", "global"],
  },
  { key: "user", label: "User", filter: { param: "actor", kind: "text" }, requiredIn: [] },
  {
    key: "title",
    label: "Title",
    filter: { param: "title", kind: "text" },
    sortKey: "title",
    requiredIn: ["project", "global"],
  },
  {
    key: "project",
    label: "Project",
    filter: { param: "project", kind: "text" },
    requiredIn: ["global"],
  },
  {
    key: "projectReference",
    label: "Project Reference",
    filter: { param: "project", kind: "text" },
    requiredIn: [],
  },
  {
    key: "module",
    label: "Module",
    filter: { param: "module", kind: "enum", options: HISTORY_MODULES },
    requiredIn: [],
  },
  {
    key: "action",
    label: "Action",
    filter: { param: "action", kind: "enum", options: HISTORY_ACTIONS },
    requiredIn: [],
  },
  {
    key: "outcome",
    label: "Outcome",
    filter: { param: "outcome", kind: "enum", options: HISTORY_OUTCOMES },
    requiredIn: [],
  },
  { key: "phase", label: "Phase", filter: { param: "phase", kind: "text" }, requiredIn: [] },
  {
    key: "eventType",
    label: "Event Type",
    filter: { param: "eventType", kind: "text" },
    sortKey: "eventType",
    requiredIn: [],
  },
  {
    key: "entityType",
    label: "Entity Type",
    filter: { param: "entityType", kind: "text" },
    requiredIn: [],
  },
  {
    key: "entityReference",
    label: "Entity Reference",
    filter: { param: "entityReference", kind: "text" },
    requiredIn: [],
  },
  {
    key: "entityTitle",
    label: "Entity Title",
    filter: { param: "entityTitle", kind: "text" },
    requiredIn: [],
  },
  {
    key: "source",
    label: "Source",
    filter: { param: "sourceSystem", kind: "enum", options: HISTORY_SOURCES },
    requiredIn: [],
  },
  { key: "reason", label: "Reason", filter: { param: "reason", kind: "text" }, requiredIn: [] },
  {
    key: "documentType",
    label: "Document Type",
    filter: { param: "documentType", kind: "text" },
    requiredIn: [],
  },
  {
    key: "documentNumber",
    label: "Document Number",
    filter: { param: "documentNumber", kind: "text" },
    requiredIn: [],
  },
  {
    key: "changedFields",
    label: "Changed Fields",
    filter: { param: "changedField", kind: "text" },
    requiredIn: [],
  },
  {
    key: "correlationId",
    label: "Correlation ID",
    filter: { param: "correlationId", kind: "uuid" },
    requiredIn: [],
  },
  { key: "eventId", label: "Event ID", filter: { param: "eventId", kind: "uuid" }, requiredIn: [] },
  {
    key: "legacyDerived",
    label: "Legacy Derived",
    filter: { param: "legacyDerived", kind: "boolean" },
    requiredIn: [],
  },
];

export const HISTORY_COLUMN_BY_KEY: Record<HistoryColumnKey, HistoryColumn> = Object.fromEntries(
  HISTORY_COLUMNS.map((c) => [c.key, c]),
) as Record<HistoryColumnKey, HistoryColumn>;

export const DEFAULT_COLUMNS: Record<HistoryScope, HistoryColumnKey[]> = {
  project: ["occurredAt", "user", "title", "module", "action", "outcome"],
  global: ["occurredAt", "user", "title", "project", "module", "action", "outcome"],
};

export function isRequiredColumn(key: HistoryColumnKey, scope: HistoryScope): boolean {
  return HISTORY_COLUMN_BY_KEY[key].requiredIn.includes(scope);
}

export function isHistoryColumnKey(value: unknown): value is HistoryColumnKey {
  return typeof value === "string" && (HISTORY_COLUMN_KEYS as readonly string[]).includes(value);
}

/**
 * Discards unknown/duplicate keys and re-inserts any missing required column
 * so a stale stored preference can never hide an audit-required column.
 */
export function sanitiseColumnSelection(raw: unknown, scope: HistoryScope): HistoryColumnKey[] {
  const seen = new Set<HistoryColumnKey>();
  const out: HistoryColumnKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (isHistoryColumnKey(value) && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  if (out.length === 0) return [...DEFAULT_COLUMNS[scope]];
  for (const key of DEFAULT_COLUMNS[scope]) {
    if (isRequiredColumn(key, scope) && !seen.has(key)) out.unshift(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query contract
// ---------------------------------------------------------------------------

export const HISTORY_PAGE_SIZES = [20, 50, 100] as const;
export const HISTORY_TEXT_MAX = 100;
export const HISTORY_EXPORT_CAP = 50_000;

export const TEXT_FILTER_PARAMS = [
  "actor",
  "title",
  "project",
  "phase",
  "eventType",
  "entityType",
  "entityReference",
  "entityTitle",
  "reason",
  "documentType",
  "documentNumber",
  "changedField",
] as const;
export const ENUM_FILTER_PARAMS = { module: HISTORY_MODULES, action: HISTORY_ACTIONS, outcome: HISTORY_OUTCOMES, sourceSystem: HISTORY_SOURCES } as const;
export const UUID_FILTER_PARAMS = ["correlationId", "eventId"] as const;

export const HISTORY_QUERY_PARAMS = [
  "scope",
  "projectId",
  "dateFrom",
  "dateTo",
  ...TEXT_FILTER_PARAMS,
  ...Object.keys(ENUM_FILTER_PARAMS),
  ...UUID_FILTER_PARAMS,
  "legacyDerived",
  "sortKey",
  "sortDirection",
  "cursor",
  "limit",
  "columns",
] as const;

export type HistoryFilters = {
  dateFrom?: string; // DD/MM/YYYY
  dateTo?: string;
  text: Partial<Record<(typeof TEXT_FILTER_PARAMS)[number], string>>;
  enums: Partial<Record<keyof typeof ENUM_FILTER_PARAMS, string>>;
  uuids: Partial<Record<(typeof UUID_FILTER_PARAMS)[number], string>>;
  legacyDerived?: boolean;
};

export type HistoryQuery = {
  scope: HistoryScope;
  projectId: string | null;
  filters: HistoryFilters;
  /** UTC bounds derived from Malaysian day boundaries. */
  fromUtc: string | null;
  toUtcExclusive: string | null;
  sortKey: HistorySortKey;
  sortDirection: "asc" | "desc";
  cursor: HistoryCursor | null;
  limit: (typeof HISTORY_PAGE_SIZES)[number];
  columns: HistoryColumnKey[] | null;
};

export type HistoryCursor = { k: HistorySortKey; d: "asc" | "desc"; v: string; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KL_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Kuala_Lumpur is UTC+8 with no DST.

/** Normalises a text filter: NFC, collapsed whitespace, trimmed. */
export function normaliseFilterText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Converts a validated DD/MM/YYYY Malaysian day to its UTC start instant. */
export function malaysianDayStartUtc(display: string): Date | null {
  const iso = displayDateToIso(display);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - KL_OFFSET_MS);
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text: string): string {
  const pad = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeCursor(cursor: HistoryCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(raw: string): HistoryCursor | null {
  if (raw.length > 800 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(raw)) as Partial<HistoryCursor>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!(HISTORY_SORT_KEYS as readonly string[]).includes(parsed.k as string)) return null;
    if (parsed.d !== "asc" && parsed.d !== "desc") return null;
    if (typeof parsed.id !== "string" || !UUID_RE.test(parsed.id)) return null;
    if (typeof parsed.v !== "string" || parsed.v.length > 600) return null;
    if (parsed.k === "occurredAt" && Number.isNaN(Date.parse(parsed.v))) return null;
    return parsed as HistoryCursor;
  } catch {
    return null;
  }
}

export type ParseResult = { ok: true; query: HistoryQuery } | { ok: false; message: string };

/** Strict allowlisted parser shared by the grid API and the XLSX export. */
export function parseHistoryQuery(search: Record<string, string>): ParseResult {
  for (const key of Object.keys(search)) {
    if (!(HISTORY_QUERY_PARAMS as readonly string[]).includes(key)) {
      return { ok: false, message: `Unknown history parameter: ${key.slice(0, 40)}` };
    }
  }
  const scope = search["scope"] ?? "project";
  if (scope !== "project" && scope !== "global") {
    return { ok: false, message: "scope must be project or global" };
  }
  let projectId: string | null = null;
  if (scope === "project") {
    projectId = search["projectId"] ?? null;
    if (!projectId || !UUID_RE.test(projectId)) {
      return { ok: false, message: "A valid projectId is required for project history" };
    }
  } else if (search["projectId"] !== undefined) {
    return { ok: false, message: "projectId is not allowed for global history" };
  }

  const filters: HistoryFilters = { text: {}, enums: {}, uuids: {} };
  for (const param of TEXT_FILTER_PARAMS) {
    const raw = search[param];
    if (raw === undefined) continue;
    if (raw.length > HISTORY_TEXT_MAX * 2) return { ok: false, message: `${param} is too long` };
    const value = normaliseFilterText(raw);
    if (value.length > HISTORY_TEXT_MAX) return { ok: false, message: `${param} is too long` };
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      return { ok: false, message: `${param} contains invalid characters` };
    }
    if (value) filters.text[param] = value;
  }
  for (const [param, options] of Object.entries(ENUM_FILTER_PARAMS)) {
    const raw = search[param];
    if (raw === undefined || raw === "") continue;
    if (!(options as readonly string[]).includes(raw)) {
      return { ok: false, message: `Invalid ${param}` };
    }
    filters.enums[param as keyof typeof ENUM_FILTER_PARAMS] = raw;
  }
  for (const param of UUID_FILTER_PARAMS) {
    const raw = search[param]?.trim();
    if (!raw) continue;
    if (!UUID_RE.test(raw)) return { ok: false, message: `${param} must be a full identifier` };
    filters.uuids[param] = raw.toLowerCase();
  }
  const legacy = search["legacyDerived"];
  if (legacy !== undefined && legacy !== "") {
    if (legacy !== "true" && legacy !== "false") {
      return { ok: false, message: "legacyDerived must be true or false" };
    }
    filters.legacyDerived = legacy === "true";
  }

  let fromUtc: string | null = null;
  let toUtcExclusive: string | null = null;
  if (search["dateFrom"]) {
    const start = malaysianDayStartUtc(search["dateFrom"]);
    if (!start) return { ok: false, message: "dateFrom must be a valid DD/MM/YYYY date" };
    filters.dateFrom = search["dateFrom"];
    fromUtc = start.toISOString();
  }
  if (search["dateTo"]) {
    const start = malaysianDayStartUtc(search["dateTo"]);
    if (!start) return { ok: false, message: "dateTo must be a valid DD/MM/YYYY date" };
    filters.dateTo = search["dateTo"];
    toUtcExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  if (fromUtc && toUtcExclusive && fromUtc >= toUtcExclusive) {
    return { ok: false, message: "dateTo must not precede dateFrom" };
  }

  const sortKey = (search["sortKey"] ?? "occurredAt") as HistorySortKey;
  if (!(HISTORY_SORT_KEYS as readonly string[]).includes(sortKey)) {
    return { ok: false, message: "Unsupported sort field" };
  }
  const sortDirection = (search["sortDirection"] ?? "desc") as "asc" | "desc";
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    return { ok: false, message: "sortDirection must be asc or desc" };
  }
  const limitRaw = Number(search["limit"] ?? "50");
  if (!(HISTORY_PAGE_SIZES as readonly number[]).includes(limitRaw)) {
    return { ok: false, message: "limit must be 20, 50 or 100" };
  }

  let cursor: HistoryCursor | null = null;
  if (search["cursor"]) {
    cursor = decodeCursor(search["cursor"]);
    if (!cursor || cursor.k !== sortKey || cursor.d !== sortDirection) {
      return { ok: false, message: "The page cursor is invalid" };
    }
  }

  let columns: HistoryColumnKey[] | null = null;
  if (search["columns"] !== undefined) {
    const keys = search["columns"].split(",").filter(Boolean);
    if (keys.length === 0 || keys.length > HISTORY_COLUMN_KEYS.length) {
      return { ok: false, message: "columns is invalid" };
    }
    const seen = new Set<string>();
    for (const key of keys) {
      if (!isHistoryColumnKey(key)) return { ok: false, message: "Unknown column" };
      if (seen.has(key)) return { ok: false, message: "Duplicate column" };
      seen.add(key);
    }
    for (const col of HISTORY_COLUMNS) {
      if (col.requiredIn.includes(scope) && !seen.has(col.key)) {
        return { ok: false, message: `${col.label} is a required column` };
      }
    }
    columns = keys as HistoryColumnKey[];
  }

  return {
    ok: true,
    query: {
      scope,
      projectId,
      filters,
      fromUtc,
      toUtcExclusive,
      sortKey,
      sortDirection,
      cursor,
      limit: limitRaw as (typeof HISTORY_PAGE_SIZES)[number],
      columns,
    },
  };
}

// ---------------------------------------------------------------------------
// Event value safety
// ---------------------------------------------------------------------------

const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|auth_header|cookie|api[_-]?key|bearer|session|credential|card|iban|ip_?address|user_?agent|stack|payload)/i;

/** Redacts sensitive keys and bounds a before/after value object. */
export function redactValues(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 50)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safeKey = key.slice(0, 60);
    if (raw === null || typeof raw === "boolean" || typeof raw === "number") out[safeKey] = raw;
    else if (typeof raw === "string") out[safeKey] = raw.slice(0, 300);
    // Nested objects/arrays are dropped: no uncontrolled dumps.
  }
  let text = JSON.stringify(out);
  while (text.length > 4000) {
    const keys = Object.keys(out);
    delete out[keys[keys.length - 1] as string];
    text = JSON.stringify(out);
  }
  return Object.keys(out).length ? out : null;
}

export type HistoryRow = {
  eventId: string;
  projectId: string;
  occurredAt: string;
  recordedAt: string | null;
  user: string | null;
  title: string;
  project: string | null;
  projectReference: string | null;
  module: string;
  action: string;
  outcome: string;
  phase: string | null;
  eventType: string;
  entityType: string | null;
  entityReference: string | null;
  entityTitle: string | null;
  source: string;
  reason: string | null;
  documentType: string | null;
  documentNumber: string | null;
  changedFields: string[];
  correlationId: string;
  legacyDerived: boolean;
  details: { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
};

export type HistoryPage = {
  rows: HistoryRow[];
  nextCursor: string | null;
  pageSize: number;
  total: number | null;
  appliedFilters: string[];
};

/** Plain-text cell value for display and export. */
export function cellText(row: HistoryRow, key: HistoryColumnKey): string {
  switch (key) {
    case "occurredAt":
      return row.occurredAt;
    case "changedFields":
      return row.changedFields.join(", ");
    case "legacyDerived":
      return row.legacyDerived ? "Yes" : "No";
    default: {
      const value = row[key as keyof HistoryRow];
      return typeof value === "string" ? value : "";
    }
  }
}
