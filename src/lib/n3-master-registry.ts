/**
 * WP0B — the single canonical N3 master-data registry.
 *
 * One server-owned definition per master kind, shared by:
 *  - the Owner-only N3 Data Verification surface, and
 *  - every mounted ProjectHub business picker.
 *
 * There is exactly one spelling per dataset: no route, component or hook may
 * define its own field list, filter expression or DTO mapping. Field name
 * VARIANTS are recorded here because different N3 endpoints spell the same
 * business dimension differently; unknown live fields stay unknown and are
 * simply never mapped. Raw N3 rows never leave the server.
 */
import type { Permission } from "./projecthub-rbac";

export type MasterKind =
  | "projects"
  | "customers"
  | "suppliers"
  | "stocks"
  | "uoms"
  | "locations"
  | "users"
  | "accounts"
  | "tax-codes"
  | "terms";

/**
 * Upstream `$filter` support per dataset.
 *
 * `unproven` means no controlled live evidence exists that this exact endpoint
 * honours an OData filter expression over these exact field spellings. An
 * unproven dataset NEVER receives a `$filter`; the server performs a bounded
 * allowlisted-GET scan and matches locally, so an ignored filter can never be
 * mistaken for "no matching records" (defect: a customer containing "Motive"
 * existed but was reported as not found).
 */
export type FilterStrategy = "unproven";

export type MasterSpec = {
  kind: MasterKind;
  label: string;
  scope: string;
  /** Allowlist operation id (src/lib/n3-allowlist.ts). */
  operationId: string;
  /** Exact allowlisted Open API path, for display and diagnostics. */
  path: string;
  /** `all` = plain array payload; `page` = OData $top/$skip page envelope. */
  mode: "all" | "page";
  /** Immutable identity field variants. The first present non-empty wins. */
  idFields: string[];
  codeFields: string[];
  nameFields: string[];
  /** Safe secondary display detail already exposed by the contract. */
  detailFields: string[];
  /** Tax-rate-like numeric detail, surfaced separately for BOQ tax codes. */
  rateFields: string[];
  filterStrategy: FilterStrategy;
  /** Business (non-Owner) picker permission, when this kind is a mounted picker. */
  businessPermission: Permission | null;
  /** Human description of the searchable display dimensions. */
  searchHint: string;
};

const NAME_VARIANTS = ["companyName", "name", "Name", "description", "Description"];

export const MASTER_SPECS: Record<MasterKind, MasterSpec> = {
  projects: {
    kind: "projects",
    label: "Projects (N3 Project Codes)",
    scope: "gl-v1",
    operationId: "projects.all",
    path: "api/Projects/All",
    mode: "all",
    idFields: ["id", "Id", "projectId", "guid"],
    codeFields: ["code", "Code", "projectCode"],
    nameFields: ["projectName", ...NAME_VARIANTS],
    detailFields: ["contractSum"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:projects:read",
    searchHint: "code, name",
  },
  customers: {
    kind: "customers",
    label: "Customers",
    scope: "sales-v1",
    operationId: "customers.list",
    path: "api/Customers/List",
    mode: "page",
    idFields: ["id", "Id", "customerId", "guid"],
    codeFields: ["code", "Code", "customerCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["email", "phone1", "phone", "currencyCode"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:customers:read",
    searchHint: "code, company name, contact",
  },
  suppliers: {
    kind: "suppliers",
    label: "Suppliers",
    scope: "purchase-v1",
    operationId: "suppliers.list",
    path: "api/Suppliers/List",
    mode: "page",
    idFields: ["id", "Id", "supplierId", "guid"],
    codeFields: ["code", "Code", "supplierCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["email", "phone1", "phone", "currencyCode"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: null,
    searchHint: "code, supplier name, email",
  },
  stocks: {
    kind: "stocks",
    label: "Stock items",
    scope: "stock-v1",
    operationId: "stocks.list",
    path: "api/Stocks/List",
    mode: "page",
    idFields: ["id", "Id", "stockId", "guid"],
    codeFields: ["code", "Code", "stockCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["uom", "baseUOM", "uomCode", "stockGroup"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:stocks:read",
    searchHint: "code, description, UOM",
  },
  uoms: {
    kind: "uoms",
    label: "UOMs",
    scope: "stock-v1",
    operationId: "uoms.query",
    path: "api/UOMs/Query",
    mode: "page",
    idFields: ["id", "Id", "uomId", "guid"],
    codeFields: ["code", "Code", "uomCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["rate"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:stocks:read",
    searchHint: "code, description",
  },
  locations: {
    kind: "locations",
    label: "Stock locations",
    scope: "stock-v1",
    operationId: "stocklocations.query",
    path: "api/StockLocations/Query",
    mode: "page",
    idFields: ["id", "Id", "locationId", "guid"],
    codeFields: ["code", "Code", "locationCode"],
    nameFields: NAME_VARIANTS,
    detailFields: [],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: null,
    searchHint: "code, name",
  },
  users: {
    kind: "users",
    label: "N3 users",
    scope: "platform-v1",
    operationId: "users.list",
    path: "api/Users",
    mode: "all",
    idFields: ["userId", "id", "Id", "guid"],
    codeFields: ["userName", "code", "loginId"],
    nameFields: ["displayName", "fullName", ...NAME_VARIANTS],
    detailFields: ["email", "userEmail", "loginId"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:users:read",
    searchHint: "display name, user name, email",
  },
  accounts: {
    kind: "accounts",
    label: "GL accounts (leaf)",
    scope: "gl-v1",
    operationId: "accountcodes.leaf.query",
    path: "api/AccountCodes/Leaf/Query",
    mode: "page",
    idFields: ["id", "Id", "accountId", "guid"],
    codeFields: ["code", "Code", "accountCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["drcr", "accountType"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: null,
    searchHint: "code, name",
  },
  "tax-codes": {
    kind: "tax-codes",
    label: "Tax codes",
    scope: "platform-v1",
    operationId: "taxcodes.query",
    path: "api/TaxCodes/Query",
    mode: "page",
    idFields: ["id", "Id", "taxCodeId", "guid"],
    codeFields: ["code", "Code", "taxCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["taxType"],
    rateFields: ["rate", "taxRate", "percentage"],
    filterStrategy: "unproven",
    businessPermission: "projecthub:n3:taxcodes:read",
    searchHint: "code, description",
  },
  terms: {
    kind: "terms",
    label: "Terms",
    scope: "gl-v1",
    operationId: "terms.query",
    path: "api/Terms/Query",
    mode: "page",
    idFields: ["id", "Id", "termId", "guid"],
    codeFields: ["code", "Code", "termCode"],
    nameFields: NAME_VARIANTS,
    detailFields: ["value"],
    rateFields: [],
    filterStrategy: "unproven",
    businessPermission: null,
    searchHint: "code, description",
  },
};

export const MASTER_KINDS = Object.keys(MASTER_SPECS) as MasterKind[];

export function isMasterKind(value: string): value is MasterKind {
  return value in MASTER_SPECS;
}

/** Minimal, safe DTO. The browser never receives a raw N3 record. */
export type MasterOption = {
  /** Immutable N3 identity. Never a display code. */
  id: string;
  code: string | null;
  name: string | null;
  detail: string | null;
  rate: string | null;
};

/** Result completeness. `incomplete` never means "no matching records". */
export type Completeness = "complete" | "incomplete";

/** Normalizes a search term / display value for case-insensitive matching.
 * Unicode is preserved: Malay, Chinese and punctuation characters are never
 * stripped, only case-folded and whitespace-collapsed. */
export function normalizeForSearch(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when the option's safe display dimensions contain the term. */
export function optionMatches(option: MasterOption, term: string): boolean {
  const needle = normalizeForSearch(term);
  if (!needle) return true;
  const haystack = normalizeForSearch(
    [option.code, option.name, option.detail].filter(Boolean).join(" "),
  );
  return haystack.includes(needle);
}
