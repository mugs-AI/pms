/**
 * Read-only customer quotation readiness and preview.
 *
 * This module performs NO database mutation and NO N3 call of any kind. It
 * reads the project, its current non-superseded Detailed BOQ version, that
 * version's sections and items, and the project's phases, all under the
 * server-resolved tenant.
 *
 * A preview is NOT an N3 Sales Quotation. `postingState` is always
 * `not_posted` in this vertical and every rendered surface must say so.
 *
 * Privacy contract: the returned DTO is built field-by-field from an explicit
 * allowlist. Cost rate, cost amount, gross profit, gross margin, markup,
 * stock deduction method, N3 stock identity, internal notes, tenant GUID,
 * tenant code, N3 user id, N3 customer id and N3 project id are never copied
 * into it. Row objects are never spread.
 */
import type { Actor } from "./projecthub-actor.server";
import { calculateLine, fromScaled, MONEY_DP, toScaled } from "./projecthub-calc";
import { getProject } from "./projecthub-projects.server";

type Fail = { ok: false; status: number; message: string };

export type QuotationBlockerCode =
  | "project_cancelled"
  | "simple_budget_mode"
  | "missing_boq_version"
  | "boq_not_ready_for_review"
  | "no_quotation_lines"
  | "missing_customer_name"
  | "missing_primary_phase"
  | "n3_customer_not_linked"
  | "n3_project_code_not_linked";

export type QuotationBlocker = {
  code: QuotationBlockerCode;
  /** `preview` blocks this preview; `future_posting` only blocks a future N3 post. */
  scope: "preview" | "future_posting";
  message: string;
};

export type QuotationPreviewLine = {
  lineNumber: number;
  description: string;
  quantity: string;
  uom: string | null;
  sellingRate: string;
  sellingAmount: string;
  taxCode: string | null;
  taxRate: string | null;
  taxAmount: string;
  amountWithTax: string;
};

export type QuotationPreviewSection = {
  code: string | null;
  name: string;
  lines: QuotationPreviewLine[];
  subtotal: { selling: string; tax: string; total: string };
};

export type QuotationPreviewDocument = {
  enquiryReference: string;
  projectTitle: string;
  customerDisplayName: string;
  siteDescription: string | null;
  revisionLabel: string;
  primaryPhaseName: string;
  currency: string;
  sections: QuotationPreviewSection[];
  totals: { selling: string; tax: string; total: string };
};

export type QuotationPreviewDto = {
  previewGeneratedAt: string;
  /** Always `not_posted`: this vertical never creates an N3 document. */
  postingState: "not_posted";
  notPostedToN3Label: string;
  previewReady: boolean;
  futurePostingReady: boolean;
  blockers: QuotationBlocker[];
  document: QuotationPreviewDocument | null;
};

const NOT_POSTED_LABEL = "Not posted to N3";

const BLOCKER_TEXT: Record<QuotationBlockerCode, string> = {
  project_cancelled: "This project is cancelled or lost, so no customer quotation can be previewed.",
  simple_budget_mode:
    "Simple Budget mode does not contain quotation line detail for this first preview.",
  missing_boq_version: "This project has no current BOQ version to quote from.",
  boq_not_ready_for_review:
    "The current BOQ version is still a draft. Mark it ready for review to preview a quotation.",
  no_quotation_lines: "The current BOQ version has no valid quotation lines.",
  missing_customer_name: "This project has no customer display name.",
  missing_primary_phase: "This project has no active primary phase.",
  n3_customer_not_linked:
    "The customer is not linked to N3 yet. This does not block the preview, only a future N3 posting.",
  n3_project_code_not_linked:
    "The primary Project Code is not linked to N3 yet. This does not block the preview, only a future N3 posting.",
};

function blocker(code: QuotationBlockerCode, scope: QuotationBlocker["scope"]): QuotationBlocker {
  return { code, scope, message: BLOCKER_TEXT[code] };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Customer-safe single-line site description built from the project address. */
function siteDescription(project: Record<string, unknown>): string | null {
  const parts = [
    text(project["site_address_line1"]),
    text(project["site_address_line2"]),
    [text(project["site_postcode"]), text(project["site_city"])].filter(Boolean).join(" "),
    text(project["site_state"]),
    text(project["site_country"]),
  ].filter((part) => Boolean(part) && part !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

type Acc = { selling: bigint; tax: bigint };
const emptyAcc = (): Acc => ({ selling: 0n, tax: 0n });

function money(scaled: bigint): string {
  return fromScaled(scaled, MONEY_DP);
}

function totalsOf(acc: Acc) {
  return {
    selling: money(acc.selling),
    tax: money(acc.tax),
    total: money(acc.selling + acc.tax),
  };
}

/**
 * Builds the read-only readiness result plus, when ready, the minimized
 * customer-preview document.
 */
export async function getQuotationPreview(
  actor: Actor,
  projectId: string,
): Promise<{ ok: true; quotation: QuotationPreviewDto } | Fail> {
  // Visibility, tenant scope and assigned-project scope all come from the
  // existing helper; a project the actor cannot see is a plain 404.
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const project = found.project;

  const blockers: QuotationBlocker[] = [];
  const previewGeneratedAt = new Date().toISOString();

  const base = (document: QuotationPreviewDocument | null): QuotationPreviewDto => ({
    previewGeneratedAt,
    postingState: "not_posted",
    notPostedToN3Label: NOT_POSTED_LABEL,
    previewReady: document !== null,
    futurePostingReady:
      document !== null && blockers.every((b) => b.scope !== "future_posting"),
    blockers,
    document,
  });

  // Future-posting blockers never stop the preview itself.
  if (!text(project["n3_customer_id"])) blockers.push(blocker("n3_customer_not_linked", "future_posting"));

  if (project["status"] === "cancelled_lost") {
    blockers.push(blocker("project_cancelled", "preview"));
    return { ok: true, quotation: base(null) };
  }
  if (project["budget_mode"] === "simple_budget") {
    blockers.push(blocker("simple_budget_mode", "preview"));
    return { ok: true, quotation: base(null) };
  }

  const customerDisplayName =
    text(project["n3_customer_name"]) ?? text(project["requested_customer_name"]);
  if (!customerDisplayName) blockers.push(blocker("missing_customer_name", "preview"));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: phaseRows, error: phaseError } = await supabaseAdmin
    .from("projecthub_project_phases")
    .select("id, phase_kind, phase_name, is_active, link_status, n3_project_id")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId);
  if (phaseError) return { ok: false, status: 503, message: "The quotation preview is unavailable" };

  const primaryPhase = (phaseRows ?? []).find(
    (row) => row.phase_kind === "primary" && row.is_active === true,
  );
  if (!primaryPhase) blockers.push(blocker("missing_primary_phase", "preview"));
  if (primaryPhase && !text(primaryPhase.n3_project_id)) {
    blockers.push(blocker("n3_project_code_not_linked", "future_posting"));
  }

  const { data: versionRows, error: versionError } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .select("id, version_number, revision_label, status")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false });
  if (versionError)
    return { ok: false, status: 503, message: "The quotation preview is unavailable" };

  // Never silently substitute a superseded version.
  const current = (versionRows ?? []).find((row) => row.status !== "superseded");
  if (!current) {
    blockers.push(blocker("missing_boq_version", "preview"));
    return { ok: true, quotation: base(null) };
  }
  if (current.status !== "ready_for_review") {
    blockers.push(blocker("boq_not_ready_for_review", "preview"));
    return { ok: true, quotation: base(null) };
  }

  const [sectionResult, itemResult] = await Promise.all([
    supabaseAdmin
      .from("projecthub_boq_sections")
      .select("id, code, name, sort_order")
      .eq("tenant_id", actor.tenantRowId)
      .eq("project_id", projectId)
      .eq("boq_version_id", current.id)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("projecthub_boq_items")
      .select(
        "id, section_id, line_number, description, quantity, uom_code, uom_name, selling_rate, tax_code, tax_rate",
      )
      .eq("tenant_id", actor.tenantRowId)
      .eq("project_id", projectId)
      .eq("boq_version_id", current.id)
      .order("line_number", { ascending: true }),
  ]);
  if (sectionResult.error || itemResult.error) {
    return { ok: false, status: 503, message: "The quotation preview is unavailable" };
  }

  // A quotation line must have a positive quantity and a positive selling rate.
  const quotableRows = (itemResult.data ?? []).filter(
    (row) =>
      toScaled(row.quantity as unknown as string, 4) > 0n &&
      toScaled(row.selling_rate as unknown as string, 4) > 0n,
  );
  if (quotableRows.length === 0) blockers.push(blocker("no_quotation_lines", "preview"));

  if (blockers.some((b) => b.scope === "preview")) {
    return { ok: true, quotation: base(null) };
  }

  const sectionMeta = new Map<string, { code: string | null; name: string }>();
  for (const row of sectionResult.data ?? []) {
    sectionMeta.set(row.id, { code: text(row.code), name: row.name });
  }

  const grouped = new Map<string, { lines: QuotationPreviewLine[]; acc: Acc }>();
  const overall = emptyAcc();

  for (const row of quotableRows) {
    // Deterministic BigInt arithmetic; only the selling side is read.
    const totals = calculateLine({
      itemType: "quotation",
      quantity: row.quantity as unknown as string,
      costRate: "0",
      sellingRate: row.selling_rate as unknown as string,
      taxRate: (row.tax_rate as unknown as string | null) ?? null,
    });

    const line: QuotationPreviewLine = {
      lineNumber: row.line_number,
      description: row.description,
      quantity: String(row.quantity),
      uom: text(row.uom_code) ?? text(row.uom_name),
      sellingRate: String(row.selling_rate),
      sellingAmount: totals.sellingAmount,
      taxCode: text(row.tax_code),
      taxRate: row.tax_rate === null || row.tax_rate === undefined ? null : String(row.tax_rate),
      taxAmount: totals.taxAmount,
      amountWithTax: totals.sellingAmountWithTax,
    };

    const key = row.section_id ?? "__unsectioned__";
    const bucket = grouped.get(key) ?? { lines: [], acc: emptyAcc() };
    bucket.lines.push(line);
    bucket.acc.selling += toScaled(totals.sellingAmount, MONEY_DP);
    bucket.acc.tax += toScaled(totals.taxAmount, MONEY_DP);
    grouped.set(key, bucket);

    overall.selling += toScaled(totals.sellingAmount, MONEY_DP);
    overall.tax += toScaled(totals.taxAmount, MONEY_DP);
  }

  const orderedKeys = [
    ...(sectionResult.data ?? []).map((row) => row.id).filter((id) => grouped.has(id)),
    ...(grouped.has("__unsectioned__") ? ["__unsectioned__"] : []),
  ];

  const sections: QuotationPreviewSection[] = orderedKeys.map((key) => {
    const bucket = grouped.get(key)!;
    const meta = sectionMeta.get(key);
    return {
      code: meta?.code ?? null,
      name: meta?.name ?? "Other items",
      lines: bucket.lines,
      subtotal: totalsOf(bucket.acc),
    };
  });

  const document: QuotationPreviewDocument = {
    enquiryReference: String(project["enquiry_reference"] ?? ""),
    projectTitle: String(project["title"] ?? ""),
    customerDisplayName: customerDisplayName as string,
    siteDescription: siteDescription(project),
    revisionLabel: text(current.revision_label) ?? `Rev ${current.version_number}`,
    primaryPhaseName: primaryPhase ? String(primaryPhase.phase_name) : "",
    currency: text(project["currency_code"]) ?? "MYR",
    sections,
    totals: totalsOf(overall),
  };

  return { ok: true, quotation: base(document) };
}
