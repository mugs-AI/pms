/**
 * BOQ versions, sections and items. Every write is scoped to the
 * server-resolved tenant AND project, and superseded versions are read-only.
 * Stock deduction methods are PLANNING metadata only — no N3 movement is ever
 * created here.
 */
import type { Actor } from "./projecthub-actor.server";
import { summariseBoq } from "./projecthub-calc";
import { resolveN3Identity } from "./projecthub-n3.server";
import { getProject, recordEvent, requireMutableProject } from "./projecthub-projects.server";
import type {
  cloneBoqVersionSchema,
  createBoqItemSchema,
  createBoqVersionSchema,
  createSectionSchema,
  updateBoqItemSchema,
  updateBoqVersionSchema,
  updateSectionSchema,
} from "./projecthub-schemas";
import type { z } from "zod";

type Fail = { ok: false; status: number; message: string };

async function loadVersion(actor: Actor, projectId: string, versionId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .select("id, status, version_number")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", versionId)
    .maybeSingle();
  return data;
}

function editableOrFail(version: { status: string } | null): Fail | null {
  if (!version) return { ok: false, status: 404, message: "Not found" };
  if (version.status === "superseded") {
    return { ok: false, status: 422, message: "A superseded BOQ version is read-only" };
  }
  return null;
}

export async function getBoq(
  actor: Actor,
  projectId: string,
  versionId?: string,
): Promise<{ ok: true; boq: unknown } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: versions } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .select("*")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false });

  const list = versions ?? [];
  const active = versionId ? list.find((v) => v.id === versionId) : list[0];
  if (!active)
    return {
      ok: true,
      boq: { versions: list, version: null, sections: [], items: [], summary: null },
    };

  const [sections, items] = await Promise.all([
    supabaseAdmin
      .from("projecthub_boq_sections")
      .select("*")
      .eq("tenant_id", actor.tenantRowId)
      .eq("boq_version_id", active.id)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("projecthub_boq_items")
      .select("*")
      .eq("tenant_id", actor.tenantRowId)
      .eq("boq_version_id", active.id)
      .order("line_number", { ascending: true }),
  ]);

  const rows = items.data ?? [];
  const summary = summariseBoq(
    rows.map((r) => ({
      itemType: r.item_type,
      quantity: r.quantity,
      costRate: r.cost_rate,
      sellingRate: r.selling_rate,
      taxRate: r.tax_rate,
      sectionId: r.section_id,
      projectPhaseId: r.project_phase_id,
    })),
  );

  return {
    ok: true,
    boq: { versions: list, version: active, sections: sections.data ?? [], items: rows, summary },
  };
}

export async function createVersion(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof createBoqVersionSchema>,
): Promise<{ ok: true; version: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .select("version_number")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false })
    .limit(1);

  const next = (existing?.[0]?.version_number ?? 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .insert({
      tenant_id: actor.tenantRowId,
      project_id: projectId,
      version_number: next,
      revision_label: input.revisionLabel ?? `Rev ${next}`,
      status: "draft",
      notes: input.notes,
      created_by_n3_user_id: actor.n3UserId,
      updated_by_n3_user_id: actor.n3UserId,
    })
    .select("*")
    .maybeSingle();
  if (error || !data)
    return { ok: false, status: 503, message: "The BOQ version could not be created" };

  await recordEvent(actor, projectId, {
    eventType: "boq.version_created",
    entityType: "boq_version",
    entityId: data.id,
    summary: `BOQ version ${next} created`,
  });
  return { ok: true, version: data as Record<string, unknown> };
}

export async function cloneVersion(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof cloneBoqVersionSchema>,
): Promise<{ ok: true; versionId: string } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const source = await loadVersion(actor, projectId, input.sourceVersionId);
  if (!source) return { ok: false, status: 404, message: "Not found" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("projecthub_clone_boq_version", {
    p_tenant_id: actor.tenantRowId,
    p_project_id: projectId,
    p_source_version_id: input.sourceVersionId,
    p_revision_label: (input.revisionLabel ?? null) as unknown as string,
    p_actor: actor.n3UserId as unknown as string,
  });
  if (error || !data)
    return { ok: false, status: 503, message: "The BOQ version could not be cloned" };

  await recordEvent(actor, projectId, {
    eventType: "boq.version_cloned",
    entityType: "boq_version",
    entityId: data as string,
    summary: `BOQ version cloned from revision ${source.version_number}`,
  });
  return { ok: true, versionId: data as string };
}

export async function updateVersion(
  actor: Actor,
  projectId: string,
  versionId: string,
  input: z.infer<typeof updateBoqVersionSchema>,
): Promise<{ ok: true; version: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const version = await loadVersion(actor, projectId, versionId);
  const blocked = editableOrFail(version);
  if (blocked) return blocked;

  const patch: Record<string, unknown> = { updated_by_n3_user_id: actor.n3UserId };
  if (input.revisionLabel !== undefined) patch["revision_label"] = input.revisionLabel;
  if (input.notes !== undefined) patch["notes"] = input.notes;
  if (input.status !== undefined) patch["status"] = input.status;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_versions")
    .update(patch as never)
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", versionId)
    .select("*")
    .maybeSingle();
  if (error || !data)
    return { ok: false, status: 503, message: "The BOQ version could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "boq.version_updated",
    entityType: "boq_version",
    entityId: versionId,
    summary: "BOQ version updated",
  });
  return { ok: true, version: data as Record<string, unknown> };
}

export async function createSection(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof createSectionSchema>,
): Promise<{ ok: true; section: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const version = await loadVersion(actor, projectId, input.boqVersionId);
  const blocked = editableOrFail(version);
  if (blocked) return blocked;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_sections")
    .insert({
      tenant_id: actor.tenantRowId,
      project_id: projectId,
      boq_version_id: input.boqVersionId,
      code: input.code,
      name: input.name,
      sort_order: input.sortOrder,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The section could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "boq.section_created",
    entityType: "boq_section",
    entityId: data.id,
    summary: `BOQ section added: ${input.name}`,
  });
  return { ok: true, section: data as Record<string, unknown> };
}

export async function updateSection(
  actor: Actor,
  projectId: string,
  sectionId: string,
  input: z.infer<typeof updateSectionSchema>,
): Promise<{ ok: true; section: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: current } = await supabaseAdmin
    .from("projecthub_boq_sections")
    .select("boq_version_id")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", sectionId)
    .maybeSingle();
  if (!current) return { ok: false, status: 404, message: "Not found" };
  const blocked = editableOrFail(await loadVersion(actor, projectId, current.boq_version_id));
  if (blocked) return blocked;

  const patch: Record<string, unknown> = {};
  if (input.code !== undefined) patch["code"] = input.code;
  if (input.name !== undefined) patch["name"] = input.name;
  if (input.sortOrder !== undefined) patch["sort_order"] = input.sortOrder;

  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_sections")
    .update(patch as never)
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", sectionId)
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The section could not be saved" };
  return { ok: true, section: data as Record<string, unknown> };
}

/** Non-material lines can never carry a stock reference or deduction method. */
function normaliseStockFields(input: Record<string, unknown>) {
  if (input["itemType"] && input["itemType"] !== "material") {
    input["stockDeductionMethod"] = null;
    input["n3StockId"] = null;
    input["stockCode"] = null;
    input["stockName"] = null;
  }
  return input;
}

export function prepareItemInput(raw: unknown): Record<string, unknown> {
  return normaliseStockFields({ ...(raw as Record<string, unknown>) });
}

async function assertPhaseBelongs(actor: Actor, projectId: string, phaseId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("projecthub_project_phases")
    .select("id")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", phaseId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Server-owned N3 snapshots for a BOQ line.
 *
 * The browser sends ids only; UOM code/name, tax code/rate and stock
 * code/name are re-read from live N3 so a tampered request can never persist
 * a fabricated tax rate or a stock item the tenant does not own.
 */
async function resolveItemSnapshots(
  actor: Actor,
  input: {
    itemType?: string | undefined;
    n3UomId?: string | null | undefined;
    n3TaxCodeId?: string | null | undefined;
    n3StockId?: string | null | undefined;
  },
): Promise<{ ok: true; snapshot: Record<string, unknown> } | Fail> {
  const snapshot: Record<string, unknown> = {};

  if (input.n3UomId) {
    const uom = await resolveN3Identity(actor, "uoms", input.n3UomId);
    if (!uom.ok) return uom;
    snapshot["n3_uom_id"] = uom.option.id;
    snapshot["uom_code"] = uom.option.code;
    snapshot["uom_name"] = uom.option.name;
  }

  if (input.n3TaxCodeId) {
    const tax = await resolveN3Identity(actor, "tax-codes", input.n3TaxCodeId);
    if (!tax.ok) return tax;
    snapshot["n3_tax_code_id"] = tax.option.id;
    snapshot["tax_code"] = tax.option.code;
    snapshot["tax_rate"] = tax.option.rate ?? null;
  }

  if (input.n3StockId) {
    if (input.itemType && input.itemType !== "material") {
      return { ok: false, status: 422, message: "Only material lines can deduct N3 stock" };
    }
    const stock = await resolveN3Identity(actor, "stocks", input.n3StockId);
    if (!stock.ok) return stock;
    snapshot["n3_stock_id"] = stock.option.id;
    snapshot["stock_code"] = stock.option.code;
    snapshot["stock_name"] = stock.option.name;
  }

  return { ok: true, snapshot };
}

export async function createItem(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof createBoqItemSchema>,
): Promise<{ ok: true; item: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const version = await loadVersion(actor, projectId, input.boqVersionId);
  const blocked = editableOrFail(version);
  if (blocked) return blocked;
  if (!(await assertPhaseBelongs(actor, projectId, input.projectPhaseId))) {
    return {
      ok: false,
      status: 422,
      message: "The selected phase does not belong to this project",
    };
  }

  const snapshots = await resolveItemSnapshots(actor, input);
  if (!snapshots.ok) return snapshots;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (input.sectionId) {
    const { data: section } = await supabaseAdmin
      .from("projecthub_boq_sections")
      .select("id")
      .eq("tenant_id", actor.tenantRowId)
      .eq("boq_version_id", input.boqVersionId)
      .eq("id", input.sectionId)
      .maybeSingle();
    if (!section)
      return {
        ok: false,
        status: 422,
        message: "The selected section does not belong to this version",
      };
  }

  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_items")
    .insert({
      tenant_id: actor.tenantRowId,
      project_id: projectId,
      boq_version_id: input.boqVersionId,
      section_id: input.sectionId ?? null,
      project_phase_id: input.projectPhaseId,
      line_number: input.lineNumber,
      item_type: input.itemType,
      description: input.description,
      quantity: input.quantity,
      n3_uom_id: null,
      uom_code: null,
      uom_name: null,
      cost_rate: input.costRate,
      selling_rate: input.sellingRate,
      n3_tax_code_id: null,
      tax_code: null,
      tax_rate: null,
      n3_stock_id: null,
      stock_code: null,
      stock_name: null,
      stock_deduction_method:
        input.itemType === "material" ? (input.stockDeductionMethod ?? null) : null,
      notes: input.notes,
      // Server-resolved N3 snapshots always win over browser-supplied values.
      ...snapshots.snapshot,
      created_by_n3_user_id: actor.n3UserId,
      updated_by_n3_user_id: actor.n3UserId,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The BOQ line could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "boq.item_created",
    entityType: "boq_item",
    entityId: data.id,
    summary: `BOQ line added: ${input.description.slice(0, 80)}`,
    metadata: {
      itemType: input.itemType,
      stockDeductionMethod: input.stockDeductionMethod ?? null,
    },
  });
  return { ok: true, item: data as Record<string, unknown> };
}

export async function updateItem(
  actor: Actor,
  projectId: string,
  itemId: string,
  input: z.infer<typeof updateBoqItemSchema>,
): Promise<{ ok: true; item: Record<string, unknown> } | Fail> {
  const found = await requireMutableProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: current } = await supabaseAdmin
    .from("projecthub_boq_items")
    .select("boq_version_id, item_type")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", itemId)
    .maybeSingle();
  if (!current) return { ok: false, status: 404, message: "Not found" };
  const blocked = editableOrFail(await loadVersion(actor, projectId, current.boq_version_id));
  if (blocked) return blocked;

  if (input.projectPhaseId && !(await assertPhaseBelongs(actor, projectId, input.projectPhaseId))) {
    return {
      ok: false,
      status: 422,
      message: "The selected phase does not belong to this project",
    };
  }

  const patch: Record<string, unknown> = { updated_by_n3_user_id: actor.n3UserId };
  const map: Record<string, unknown> = {
    section_id: input.sectionId,
    project_phase_id: input.projectPhaseId,
    line_number: input.lineNumber,
    item_type: input.itemType,
    description: input.description,
    quantity: input.quantity,
    cost_rate: input.costRate,
    selling_rate: input.sellingRate,
    stock_deduction_method: input.stockDeductionMethod,
    notes: input.notes,
  };
  for (const [key, value] of Object.entries(map)) if (value !== undefined) patch[key] = value;

  // Any N3 reference the caller changed is re-resolved server-side.
  const snapshots = await resolveItemSnapshots(actor, {
    ...input,
    itemType: (input.itemType ?? current.item_type) as string,
  });
  if (!snapshots.ok) return snapshots;
  Object.assign(patch, snapshots.snapshot);

  // Changing away from material clears the planned stock movement.
  const nextType = (input.itemType ?? current.item_type) as string;
  if (nextType !== "material") {
    patch["stock_deduction_method"] = null;
    patch["n3_stock_id"] = null;
    patch["stock_code"] = null;
    patch["stock_name"] = null;
  }

  const { data, error } = await supabaseAdmin
    .from("projecthub_boq_items")
    .update(patch as never)
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", itemId)
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The BOQ line could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "boq.item_updated",
    entityType: "boq_item",
    entityId: itemId,
    summary: "BOQ line updated",
  });
  return { ok: true, item: data as Record<string, unknown> };
}
