/**
 * ProjectHub business master-data pickers.
 *
 * Separate from the Owner-only verification proxy: these reads are available
 * to authorised ProjectHub roles, are still GET-only, still bounded by the
 * shared transport limits, and return MINIMAL picker DTOs rather than raw N3
 * payloads. No write operation exists here or anywhere else in ProjectHub.
 */
import { ALLOWED_OPERATIONS, MAX_TOP, validateQuery } from "./n3-allowlist";
import { n3Get } from "./n3-api.server";
import { writeDiagnostic } from "./n3-session.server";
import type { Actor } from "./projecthub-actor.server";
import type { Permission } from "./projecthub-rbac";

export type PickerKind = "customers" | "projects" | "stocks" | "uoms" | "tax-codes" | "users";

export type PickerOption = {
  /** Immutable N3 identity. Never a display code. */
  id: string;
  code: string | null;
  name: string | null;
  /** Optional secondary display line (e.g. UOM, tax rate, email). */
  detail: string | null;
  /** Tax rate percentage when the source is a tax code. */
  rate: string | null;
};

type PickerSpec = {
  operationId: string;
  permission: Permission;
  searchFields: string[];
  supportsPaging: boolean;
};

const SPECS: Record<PickerKind, PickerSpec> = {
  // P1-N3-CUST-01: the customer search contract is defined exactly once,
  // here. The New Enquiry business picker and the Verification customers tab
  // both reach N3 through this single normalized expression — a
  // case-insensitive `contains` match over the Customers/List contract
  // fields `code` and `companyName` (see buildFilter). No other customer
  // search spelling exists anywhere in the app.
  customers: {
    operationId: "customers.list",
    permission: "projecthub:n3:customers:read",
    searchFields: ["code", "companyName"],
    supportsPaging: true,
  },
  projects: {
    operationId: "projects.all",
    permission: "projecthub:n3:projects:read",
    searchFields: [],
    supportsPaging: false,
  },
  stocks: {
    operationId: "stocks.list",
    permission: "projecthub:n3:stocks:read",
    searchFields: ["code", "description"],
    supportsPaging: true,
  },
  uoms: {
    operationId: "uoms.query",
    permission: "projecthub:n3:stocks:read",
    searchFields: ["code"],
    supportsPaging: true,
  },
  "tax-codes": {
    operationId: "taxcodes.query",
    permission: "projecthub:n3:taxcodes:read",
    searchFields: ["code"],
    supportsPaging: true,
  },
  users: {
    operationId: "users.list",
    permission: "projecthub:n3:users:read",
    searchFields: [],
    supportsPaging: false,
  },
};

export function pickerPermission(kind: PickerKind): Permission {
  return SPECS[kind].permission;
}

export function isPickerKind(value: string): value is PickerKind {
  return value in SPECS;
}

/**
 * Server-owned OData filter. Only safe characters survive.
 *
 * Normalized semantics (the only spelling ever sent to N3): the trimmed
 * term is lowercased server-side and matched with `contains(tolower(field),
 * 'term')` across each contract field, joined with `or`.
 */
function buildFilter(fields: string[], search: string): string | null {
  const cleaned = search
    .replace(/[^A-Za-z0-9 ._\-/&()]/g, "")
    .trim()
    .slice(0, 60);
  if (!cleaned || fields.length === 0) return null;
  return fields.map((f) => `contains(tolower(${f}),'${cleaned.toLowerCase()}')`).join(" or ");
}

function str(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 300 ? trimmed : null;
}

function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(row[key]);
    if (value) return value;
  }
  return null;
}

function mapRow(kind: PickerKind, raw: unknown): PickerOption | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = pick(row, ["id", "Id", "guid", "recordKey", "stockId", "customerId", "projectId"]);
  if (!id) return null;
  const code = pick(row, ["code", "Code", "customerCode", "projectCode", "stockCode", "taxCode"]);
  const name = pick(row, [
    "companyName",
    "name",
    "Name",
    "description",
    "Description",
    "projectName",
    "displayName",
    "userName",
  ]);
  let detail: string | null = null;
  let rate: string | null = null;
  if (kind === "stocks") detail = pick(row, ["uom", "baseUOM", "uomCode", "stockGroup"]);
  if (kind === "users") detail = pick(row, ["email", "userEmail", "loginId"]);
  if (kind === "customers") detail = pick(row, ["email", "phone1", "phone"]);
  if (kind === "tax-codes") {
    rate = pick(row, ["rate", "taxRate", "percentage"]);
    detail = rate ? `${rate}%` : null;
  }
  return { id, code, name, detail, rate };
}

/**
 * Unwraps the N3 page envelope WITHOUT inventing a total.
 *
 * `total` is the upstream-reported record count, returned only when N3
 * actually supplied a finite, non-negative number. When the count is absent
 * or non-numeric, `total` is `null` so callers can surface an explicit
 * "total unknown / results may be incomplete" state instead of a fabricated
 * figure. A bare array (non-paged endpoint) yields an exact total.
 */
function extractPage(body: unknown): { rows: unknown[]; total: number | null } | null {
  const envelope = body as { code?: string; success?: boolean; data?: unknown } | null;
  if (!envelope || (envelope.code !== "0000" && envelope.success !== true)) return null;
  const data = envelope.data;
  if (Array.isArray(data)) return { rows: data, total: data.length };
  const page = data as { value?: unknown; count?: unknown } | null;
  if (page && Array.isArray(page.value)) {
    const raw = page.count;
    const total = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
    return { rows: page.value, total };
  }
  return null;
}

export type PickerResult =
  | { ok: true; options: PickerOption[]; total: number | null; hasMore: boolean }
  | { ok: false; status: number; message: string };

/** Bounded scan budget for server-side identity re-resolution. */
export const MAX_RESOLVE_PAGES = 10;
const RESOLVE_PAGE_SIZE = 100;

export type IdentityResolution =
  { ok: true; option: PickerOption } | { ok: false; status: number; message: string };

/**
 * Re-resolves an immutable N3 identity server-side.
 *
 * The browser may only ever send an `id`. Every display snapshot (code, name,
 * detail, tax rate) is taken from THIS result, so a tampered request body can
 * never persist a fabricated code, name, UOM, tax rate or stock identity.
 * GET-only, bounded, uses the caller's own live N3 bearer token, fails closed.
 */
export async function resolveN3Identity(
  actor: Actor,
  kind: PickerKind,
  id: string,
): Promise<IdentityResolution> {
  const wanted = id.trim();
  if (!wanted) return { ok: false, status: 422, message: "An N3 record must be selected" };

  for (let page = 0; page < MAX_RESOLVE_PAGES; page += 1) {
    const result = await readPicker(actor, kind, { page, pageSize: RESOLVE_PAGE_SIZE });
    if (!result.ok) {
      return { ok: false, status: 503, message: "N3 master data could not be verified" };
    }
    const match = result.options.find((option) => option.id === wanted);
    if (match) return { ok: true, option: match };
    if (result.options.length < RESOLVE_PAGE_SIZE) break;
  }
  return {
    ok: false,
    status: 422,
    message: "The selected N3 record could not be verified in your live N3 tenant",
  };
}

/** Reads one allowlisted master list and maps it to picker DTOs. Fails closed. */
export async function readPicker(
  actor: Actor,
  kind: PickerKind,
  query: { search?: string | undefined; page: number; pageSize: number },
): Promise<PickerResult> {
  const spec = SPECS[kind];
  const operation = ALLOWED_OPERATIONS.find((op) => op.id === spec.operationId);
  if (!operation) return { ok: false, status: 404, message: "Unknown picker" };

  const params = new URLSearchParams();
  if (spec.supportsPaging) {
    const top = Math.min(query.pageSize, MAX_TOP);
    params.set("$top", String(top));
    params.set("$skip", String(query.page * top));
    const filter = query.search ? buildFilter(spec.searchFields, query.search) : null;
    if (filter) params.set("$filter", filter);
  }
  const validated = validateQuery(operation, params);
  if (!validated.ok) return { ok: false, status: 400, message: "Unsupported picker query" };

  const startedAt = new Date().toISOString();
  const upstream = await n3Get("main", operation.path, validated.search, actor.bearer);
  const endedAt = new Date().toISOString();

  if (!upstream.ok) {
    await writeDiagnostic({
      tenantRowId: actor.tenantRowId,
      actor: actor.n3UserId,
      correlationId: actor.correlationId,
      operationId: `picker.${kind}`,
      startedAt,
      endedAt,
      statusCode: upstream.status,
      outcome: upstream.outcome,
      errorCode: upstream.outcome,
    });
    return { ok: false, status: upstream.status, message: "N3 master data could not be read" };
  }

  const rows = extractRows(upstream.body);
  if (rows === null) {
    await writeDiagnostic({
      tenantRowId: actor.tenantRowId,
      actor: actor.n3UserId,
      correlationId: actor.correlationId,
      operationId: `picker.${kind}`,
      startedAt,
      endedAt,
      statusCode: upstream.status,
      outcome: "contract_mismatch",
      errorCode: "contract_mismatch",
    });
    return { ok: false, status: 502, message: "N3 returned an unexpected master-data contract" };
  }

  await writeDiagnostic({
    tenantRowId: actor.tenantRowId,
    actor: actor.n3UserId,
    correlationId: actor.correlationId,
    operationId: `picker.${kind}`,
    startedAt,
    endedAt,
    statusCode: upstream.status,
    outcome: "succeeded",
    responseBytes: upstream.bytes,
  });

  let options = rows.map((row) => mapRow(kind, row)).filter((o): o is PickerOption => o !== null);

  // Endpoints without OData support are filtered/paged server-side instead.
  if (!spec.supportsPaging) {
    const search = query.search?.trim().toLowerCase();
    if (search) {
      options = options.filter((o) =>
        `${o.code ?? ""} ${o.name ?? ""} ${o.detail ?? ""}`.toLowerCase().includes(search),
      );
    }
    const total = options.length;
    const start = query.page * query.pageSize;
    return { ok: true, options: options.slice(start, start + query.pageSize), total };
  }

  return { ok: true, options, total: options.length };
}
