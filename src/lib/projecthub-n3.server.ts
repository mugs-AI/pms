/**
 * ProjectHub canonical N3 master-data search service (WP0B).
 *
 * Every mounted search surface — the Owner-only N3 Data Verification tabs and
 * every business picker — reaches N3 through this one module and the one
 * registry in `n3-master-registry.ts`. Reads are GET-only, allowlisted,
 * bounded by the shared transport limits, and return MINIMAL DTOs. No write
 * operation exists here or anywhere else in ProjectHub.
 *
 * Search strategy: no dataset has live-proven upstream `$filter` support, so
 * NO `$filter` is ever sent. Matching happens server-side over the normalized
 * safe DTO fields after a bounded scan of allowlisted GET pages. That is what
 * makes completeness truthful: an ignored upstream filter can never be
 * reported as "no matching records".
 */
import { ALLOWED_OPERATIONS, MAX_TOP, validateQuery } from "./n3-allowlist";
import { n3Get } from "./n3-api.server";
import {
  MASTER_SPECS,
  isMasterKind,
  optionMatches,
  type Completeness,
  type MasterKind,
  type MasterOption,
  type MasterSpec,
} from "./n3-master-registry";
import { writeDiagnostic } from "./n3-session.server";
import type { Actor } from "./projecthub-actor.server";
import type { Permission } from "./projecthub-rbac";

export type PickerKind = "customers" | "projects" | "stocks" | "uoms" | "tax-codes" | "users";
export type PickerOption = MasterOption;

const PICKER_KINDS: PickerKind[] = [
  "customers",
  "projects",
  "stocks",
  "uoms",
  "tax-codes",
  "users",
];

export function isPickerKind(value: string): value is PickerKind {
  return (PICKER_KINDS as string[]).includes(value);
}

export function pickerPermission(kind: PickerKind): Permission {
  const permission = MASTER_SPECS[kind].businessPermission;
  if (!permission) throw new Error(`No business permission for picker ${kind}`);
  return permission;
}

/* ------------------------------------------------------------------ */
/* Bounded scan budget                                                 */
/* ------------------------------------------------------------------ */

/** Largest page the allowlist permits, minus the completeness probe row. */
export const SCAN_PAGE_SIZE = MAX_TOP - 1;
export const MAX_SCAN_PAGES = 20;
export const MAX_SCAN_ROWS = 4000;
export const MAX_SCAN_MS = 12_000;
/** Kept for backwards compatibility with existing identity tests. */
export const MAX_RESOLVE_PAGES = MAX_SCAN_PAGES;

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

function str(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
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

export function mapMasterRow(spec: MasterSpec, raw: unknown): MasterOption | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = pick(row, spec.idFields);
  if (!id) return null;
  const rate = pick(row, spec.rateFields);
  const detail = rate ? `${rate}%` : pick(row, spec.detailFields);
  return {
    id,
    code: pick(row, spec.codeFields),
    name: pick(row, spec.nameFields),
    detail,
    rate,
  };
}

/**
 * Unwraps the N3 page envelope WITHOUT inventing a total. `total` is returned
 * only when the upstream actually supplied a finite non-negative count.
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

/* ------------------------------------------------------------------ */
/* Single allowlisted page read                                        */
/* ------------------------------------------------------------------ */

type PageRead =
  | { ok: true; options: MasterOption[]; rawCount: number; total: number | null }
  | { ok: false; status: number; message: string };

async function readOnePage(
  actor: Actor,
  spec: MasterSpec,
  window: { top: number; skip: number } | null,
): Promise<PageRead> {
  const operation = ALLOWED_OPERATIONS.find((op) => op.id === spec.operationId);
  if (!operation) return { ok: false, status: 404, message: "Unknown N3 dataset" };

  const params = new URLSearchParams();
  if (window && spec.mode === "page") {
    params.set("$top", String(window.top));
    params.set("$skip", String(window.skip));
  }
  const validated = validateQuery(operation, params);
  if (!validated.ok) return { ok: false, status: 400, message: "Unsupported N3 query" };

  const startedAt = new Date().toISOString();
  const upstream = await n3Get("main", operation.path, validated.search, actor.bearer);
  const endedAt = new Date().toISOString();

  const diagnose = (outcome: string, statusCode: number, responseBytes?: number) =>
    writeDiagnostic({
      tenantRowId: actor.tenantRowId,
      actor: actor.n3UserId,
      correlationId: actor.correlationId,
      operationId: `master.${spec.kind}`,
      startedAt,
      endedAt,
      statusCode,
      outcome,
      responseBytes: responseBytes ?? null,
      ...(outcome === "succeeded" ? { responseBytes } : { errorCode: outcome }),
    });

  if (!upstream.ok) {
    await diagnose(upstream.outcome, upstream.status);
    return { ok: false, status: upstream.status, message: "N3 master data could not be read" };
  }

  const page = extractPage(upstream.body);
  if (page === null) {
    await diagnose("contract_mismatch", upstream.status);
    return { ok: false, status: 502, message: "N3 returned an unexpected master-data contract" };
  }

  await diagnose("succeeded", upstream.status, upstream.bytes);

  return {
    ok: true,
    options: page.rows
      .map((row) => mapMasterRow(spec, row))
      .filter((o): o is MasterOption => o !== null),
    rawCount: page.rows.length,
    total: page.total,
  };
}

/* ------------------------------------------------------------------ */
/* Bounded scan                                                        */
/* ------------------------------------------------------------------ */

type ScanOutcome =
  | {
      ok: true;
      matches: MasterOption[];
      completeness: Completeness;
      reason: string | null;
      scanned: number;
    }
  | { ok: false; status: number; message: string };

/**
 * Scans a dataset with allowlisted GETs and collects locally matching rows.
 * Stops on a proven end (empty page, short final page), on repeated/
 * non-progressing pages, on the page/row/time budget, or when `stopEarly`
 * reports that the caller has everything it needs.
 */
async function scanDataset(
  actor: Actor,
  spec: MasterSpec,
  predicate: (option: MasterOption) => boolean,
  stopEarly?: (matches: MasterOption[]) => boolean,
): Promise<ScanOutcome> {
  const startedAt = Date.now();
  const seen = new Set<string>();
  const matchedIds = new Set<string>();
  const matches: MasterOption[] = [];
  let scanned = 0;

  if (spec.mode === "all") {
    const read = await readOnePage(actor, spec, null);
    if (!read.ok) return read;
    for (const option of read.options) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      if (predicate(option)) matches.push(option);
    }
    return { ok: true, matches, completeness: "complete", reason: null, scanned: read.rawCount };
  }

  let skip = 0;
  for (let pageNo = 0; ; pageNo += 1) {
    if (pageNo >= MAX_SCAN_PAGES) {
      return { ok: true, matches, completeness: "incomplete", reason: "page_budget", scanned };
    }
    if (Date.now() - startedAt > MAX_SCAN_MS) {
      return { ok: true, matches, completeness: "incomplete", reason: "time_budget", scanned };
    }

    // One extra row is the completeness probe: it proves whether further rows
    // exist without trusting (or inventing) an upstream count.
    const read = await readOnePage(actor, spec, { top: SCAN_PAGE_SIZE + 1, skip });
    if (!read.ok) return read;

    scanned += read.rawCount;
    if (read.rawCount === 0) {
      return { ok: true, matches, completeness: "complete", reason: null, scanned };
    }

    let progressed = false;
    for (const option of read.options.slice(0, SCAN_PAGE_SIZE)) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      progressed = true;
      if (predicate(option) && !matchedIds.has(option.id)) {
        matchedIds.add(option.id);
        matches.push(option);
      }
    }

    if (stopEarly?.(matches)) {
      return { ok: true, matches, completeness: "complete", reason: null, scanned };
    }
    if (!progressed) {
      return { ok: true, matches, completeness: "incomplete", reason: "non_progress", scanned };
    }
    if (read.rawCount <= SCAN_PAGE_SIZE) {
      return { ok: true, matches, completeness: "complete", reason: null, scanned };
    }
    if (scanned >= MAX_SCAN_ROWS) {
      return { ok: true, matches, completeness: "incomplete", reason: "row_budget", scanned };
    }
    skip += SCAN_PAGE_SIZE;
  }
}

/* ------------------------------------------------------------------ */
/* Public search API                                                   */
/* ------------------------------------------------------------------ */

export type MasterSearchResult =
  | {
      ok: true;
      options: MasterOption[];
      total: number | null;
      hasMore: boolean;
      completeness: Completeness;
      reason: string | null;
    }
  | { ok: false; status: number; message: string };

export type PickerResult = MasterSearchResult;

/**
 * The single search entry point for all ten master kinds.
 *
 * With no search term the browse path stays cheap: one bounded page only.
 * With a term, the contract-aware bounded scan runs so a match beyond the
 * first page is still found.
 */
export async function searchMaster(
  actor: Actor,
  kind: MasterKind,
  query: { search?: string | undefined; page: number; pageSize: number },
): Promise<MasterSearchResult> {
  const spec = MASTER_SPECS[kind];
  if (!spec) return { ok: false, status: 404, message: "Unknown N3 dataset" };

  const pageSize = Math.max(1, Math.min(query.pageSize, SCAN_PAGE_SIZE));
  const term = query.search?.trim() ?? "";

  // Browse (no term) on a paged endpoint: one page, plus the probe row.
  if (!term && spec.mode === "page") {
    const skip = query.page * pageSize;
    const read = await readOnePage(actor, spec, { top: pageSize + 1, skip });
    if (!read.ok) return read;
    const options = read.options.slice(0, pageSize);
    const hasMore = read.rawCount > pageSize;
    const total =
      read.total !== null && read.total >= skip + read.rawCount - (hasMore ? 1 : 0)
        ? read.total
        : null;
    return { ok: true, options, total, hasMore, completeness: "complete", reason: null };
  }

  const scan = await scanDataset(actor, spec, (option) => optionMatches(option, term));
  if (!scan.ok) return scan;

  const start = query.page * pageSize;
  const options = scan.matches.slice(start, start + pageSize);
  const complete = scan.completeness === "complete";
  return {
    ok: true,
    options,
    total: complete ? scan.matches.length : null,
    hasMore: complete ? start + options.length < scan.matches.length : true,
    completeness: scan.completeness,
    reason: scan.reason,
  };
}

/** Business picker read. Same contract, same registry, same completeness. */
export async function readPicker(
  actor: Actor,
  kind: PickerKind,
  query: { search?: string | undefined; page: number; pageSize: number },
): Promise<PickerResult> {
  return searchMaster(actor, kind, query);
}

export type IdentityResolution =
  { ok: true; option: PickerOption } | { ok: false; status: number; message: string };

/**
 * Re-resolves an immutable N3 identity server-side.
 *
 * The browser may only ever send an `id`. Every display snapshot (code, name,
 * detail, tax rate) is taken from THIS result, so a tampered request body can
 * never persist a fabricated code, name, UOM, tax rate or stock identity.
 * GET-only, bounded across pages (not just the first one), fails closed.
 */
export async function resolveN3Identity(
  actor: Actor,
  kind: PickerKind,
  id: string,
): Promise<IdentityResolution> {
  const wanted = id.trim();
  if (!wanted) return { ok: false, status: 422, message: "An N3 record must be selected" };

  const spec = MASTER_SPECS[kind];
  const scan = await scanDataset(
    actor,
    spec,
    (option) => option.id === wanted,
    (matches) => matches.length > 0,
  );
  if (!scan.ok) return { ok: false, status: 503, message: "N3 master data could not be verified" };

  const match = scan.matches[0];
  if (match) return { ok: true, option: match };
  return {
    ok: false,
    status: 422,
    message: "The selected N3 record could not be verified in your live N3 tenant",
  };
}

export { isMasterKind };
export type { MasterKind, MasterOption, Completeness };
