/**
 * Server-owned read allowlist for the N3 Open API proxy.
 *
 * Nothing outside this table can ever be forwarded to N3. Every entry is a GET
 * read used by the starter verification/session surface. The `reporting`
 * target has no permitted operation in this milestone.
 */

export type AllowedQueryParam = "$top" | "$skip" | "$filter" | "$orderby";

export type AllowedOperation = {
  /** Stable operation identifier used in diagnostics (never a caller-supplied URL). */
  id: string;
  /** Exact Open API path. */
  path: string;
  /** Only "main" is permitted in this milestone. */
  target: "main";
  /** Query parameters this endpoint accepts. Anything else is rejected. */
  params: AllowedQueryParam[];
  /** false only for the BasicInfo session bootstrap read. */
  ownerRequired: boolean;
};

const PAGE_PARAMS: AllowedQueryParam[] = ["$top", "$skip", "$filter", "$orderby"];

export const ALLOWED_OPERATIONS: AllowedOperation[] = [
  {
    id: "companyprofile.basicinfo",
    path: "api/CompanyProfile/BasicInfo",
    target: "main",
    params: [],
    ownerRequired: false,
  },
  { id: "users.list", path: "api/Users", target: "main", params: [], ownerRequired: true },
  {
    id: "taxcodes.query",
    path: "api/TaxCodes/Query",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "projects.all",
    path: "api/Projects/All",
    target: "main",
    params: [],
    ownerRequired: true,
  },
  {
    id: "accountcodes.leaf.query",
    path: "api/AccountCodes/Leaf/Query",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "terms.query",
    path: "api/Terms/Query",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "customers.list",
    path: "api/Customers/List",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "suppliers.list",
    path: "api/Suppliers/List",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "stocks.list",
    path: "api/Stocks/List",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "uoms.query",
    path: "api/UOMs/Query",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
  {
    id: "stocklocations.query",
    path: "api/StockLocations/Query",
    target: "main",
    params: PAGE_PARAMS,
    ownerRequired: true,
  },
];

export const BASIC_INFO_PATH = "api/CompanyProfile/BasicInfo";

export const MAX_TOP = 200;
export const MAX_SKIP = 1_000_000;
export const MAX_FILTER_LENGTH = 512;
export const MAX_ORDERBY_LENGTH = 128;
export const MAX_QUERY_LENGTH = 1024;
export const MAX_BEARER_LENGTH = 8192;

export type ValidationFailure = { ok: false; status: number; reason: string };
export type PathSuccess = { ok: true; operation: AllowedOperation };

/** Rejects traversal, encoded traversal, control characters and malformed encoding. */
export function isSafePathSegment(raw: string): boolean {
  if (!raw || raw.length > 256) return false;
  if (raw.includes("\\")) return false;
  if (raw.includes("//")) return false;
  if (raw.startsWith("/") || raw.endsWith("/")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
  if (raw.includes("%")) {
    // Percent-encoding is never required by an allowlisted path; reject it
    // outright (this also blocks %2e%2e and malformed sequences).
    return false;
  }
  if (raw.split("/").some((s) => s === "" || s === "." || s === "..")) return false;
  return true;
}

/** Resolves `<target>/<path>` against the allowlist. Never coerces the target. */
export function resolveOperation(splat: string): PathSuccess | ValidationFailure {
  const notFound: ValidationFailure = { ok: false, status: 404, reason: "not_allowlisted" };
  if (!isSafePathSegment(splat)) return notFound;

  const slash = splat.indexOf("/");
  if (slash <= 0) return notFound;
  const target = splat.slice(0, slash);
  const path = splat.slice(slash + 1);

  // "reporting" has no permitted operation in this milestone; unknown targets
  // are never coerced to "main".
  if (target !== "main") return notFound;

  const operation = ALLOWED_OPERATIONS.find((op) => op.path === path);
  if (!operation) return notFound;
  return { ok: true, operation };
}

/** Validates and rebuilds the query string from the per-endpoint allowlist. */
export function validateQuery(
  operation: AllowedOperation,
  search: URLSearchParams,
): { ok: true; search: string } | ValidationFailure {
  const bad = (reason: string): ValidationFailure => ({ ok: false, status: 400, reason });
  const out = new URLSearchParams();

  for (const key of search.keys()) {
    if (!operation.params.includes(key as AllowedQueryParam)) {
      return bad("unknown_query_parameter");
    }
    if (search.getAll(key).length > 1) return bad("duplicate_query_parameter");
  }

  const top = search.get("$top");
  if (top !== null) {
    if (!/^\d{1,7}$/.test(top)) return bad("invalid_top");
    const n = Number(top);
    if (n < 1 || n > MAX_TOP) return bad("top_out_of_range");
    out.set("$top", String(n));
  }

  const skip = search.get("$skip");
  if (skip !== null) {
    if (!/^\d{1,9}$/.test(skip)) return bad("invalid_skip");
    const n = Number(skip);
    if (n > MAX_SKIP) return bad("skip_out_of_range");
    out.set("$skip", String(n));
  }

  const filter = search.get("$filter");
  if (filter !== null) {
    if (filter.length > MAX_FILTER_LENGTH) return bad("filter_too_long");
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(filter)) return bad("invalid_filter");
    out.set("$filter", filter);
  }

  const orderby = search.get("$orderby");
  if (orderby !== null) {
    if (orderby.length > MAX_ORDERBY_LENGTH) return bad("orderby_too_long");
    if (!/^[A-Za-z0-9_,. ]+$/.test(orderby)) return bad("invalid_orderby");
    out.set("$orderby", orderby);
  }

  const qs = out.toString();
  if (qs.length > MAX_QUERY_LENGTH) return bad("query_too_long");
  return { ok: true, search: qs ? `?${qs}` : "" };
}

/** Accepts exactly one well-formed `Bearer <token>` header value. */
export function validateBearer(
  header: string | null,
): { ok: true; token: string } | ValidationFailure {
  const bad: ValidationFailure = { ok: false, status: 401, reason: "invalid_authorization" };
  if (!header) return bad;
  if (header.length > MAX_BEARER_LENGTH) return bad;
  if (header.includes(",")) return bad;
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header.trim());
  if (!match) return bad;
  const token = match[1] as string;
  if (token.length < 16) return bad;
  return { ok: true, token };
}
