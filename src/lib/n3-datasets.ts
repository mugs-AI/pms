export type Column = { key: string; label: string; mono?: boolean };

export type Dataset = {
  id: string;
  label: string;
  scope: string;
  path: string;
  /** "page" = ApiResponse<PageQueryResult<T>> with OData; "all" = plain array in data */
  mode: "page" | "all";
  /** Fields used to build the OData substringof() search filter (page mode). */
  searchFields: string[];
  idKey: string;
  columns: Column[];
};

export const DATASETS: Dataset[] = [
  {
    id: "projects",
    label: "Projects (N3 Project Codes)",
    scope: "gl-v1",
    path: "api/Projects/All",
    mode: "all",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "contractSum", label: "Contract sum" },
      { key: "isActive", label: "Active" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    scope: "sales-v1",
    path: "api/Customers/List",
    mode: "page",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "currencyCode", label: "Currency" },
      { key: "termCode", label: "Term" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "suppliers",
    label: "Suppliers",
    scope: "purchase-v1",
    path: "api/Suppliers/List",
    mode: "page",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "currencyCode", label: "Currency" },
      { key: "email", label: "Email" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "stocks",
    label: "Stock items",
    scope: "stock-v1",
    path: "api/Stocks/List",
    mode: "page",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "balance", label: "Balance" },
      { key: "isActive", label: "Active" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "uoms",
    label: "UOMs",
    scope: "stock-v1",
    path: "api/UOMs/Query",
    mode: "page",
    searchFields: ["code", "description"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "description", label: "Description" },
      { key: "rate", label: "Rate" },
      { key: "isBase", label: "Base" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "locations",
    label: "Stock locations",
    scope: "stock-v1",
    path: "api/StockLocations/Query",
    mode: "page",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "isActive", label: "Active" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "users",
    label: "N3 users",
    scope: "platform-v1",
    path: "api/Users",
    mode: "all",
    searchFields: ["displayName", "email"],
    idKey: "userId",
    columns: [
      { key: "displayName", label: "Display name" },
      { key: "userName", label: "User name" },
      { key: "email", label: "Email" },
      { key: "isOwner", label: "Owner" },
      { key: "userId", label: "N3 id", mono: true },
    ],
  },
  {
    id: "accounts",
    label: "GL accounts (leaf)",
    scope: "gl-v1",
    path: "api/AccountCodes/Leaf/Query",
    mode: "page",
    searchFields: ["code", "name"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "name", label: "Name" },
      { key: "drcr", label: "DR/CR" },
      { key: "isActive", label: "Active" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "taxcodes",
    label: "Tax codes",
    scope: "platform-v1",
    path: "api/TaxCodes/Query",
    mode: "page",
    searchFields: ["code", "description"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "description", label: "Description" },
      { key: "taxType", label: "Type" },
      { key: "rate", label: "Rate" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
  {
    id: "terms",
    label: "Terms",
    scope: "gl-v1",
    path: "api/Terms/Query",
    mode: "page",
    searchFields: ["code", "description"],
    idKey: "id",
    columns: [
      { key: "code", label: "Code", mono: true },
      { key: "description", label: "Description" },
      { key: "value", label: "Value" },
      { key: "isDefault", label: "Default" },
      { key: "id", label: "N3 id", mono: true },
    ],
  },
];

export function buildODataFilter(fields: string[], search: string): string | undefined {
  const q = search.trim().replace(/'/g, "''");
  if (!q) return undefined;
  return fields.map((f) => `substringof(${f}, '${q}')`).join(" or ");
}