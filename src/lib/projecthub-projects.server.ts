/**
 * Tenant-safe ProjectHub project, phase, team and activity operations.
 * Every query carries the server-resolved tenant_id predicate; project children
 * additionally carry the project_id predicate.
 */
import type { Json } from "@/integrations/supabase/types";
import type { Actor } from "./projecthub-actor.server";
import { canViewAllProjects, roleHasPermission } from "./projecthub-rbac";
import type {
  cancelProjectSchema,
  createPhaseSchema,
  createProjectSchema,
  projectListQuerySchema,
  updatePhaseSchema,
  updateProjectSchema,
} from "./projecthub-schemas";
import type { z } from "zod";

type Fail = { ok: false; status: number; message: string };

const PROJECT_COLUMNS =
  "id, enquiry_reference, title, project_type, status, budget_mode, enquiry_date, expected_start_date, expected_end_date, description, site_address_line1, site_address_line2, site_city, site_state, site_postcode, site_country, customer_link_status, n3_customer_id, n3_customer_code, n3_customer_name, requested_customer_name, requested_customer_contact, requested_customer_email, requested_customer_phone, simple_budget_cost, simple_budget_selling, currency_code, cancellation_reason, cancellation_note, cancelled_at, created_at, updated_at";

/** Deterministic hash of the normalised creation payload for idempotent retry. */
export async function hashPayload(payload: unknown): Promise<string> {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, stable(v)]),
      );
    }
    return value;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stable(payload)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Active team membership for the caller, used by `view_assigned` roles. */
async function assignedProjectIds(actor: Actor): Promise<string[] | null> {
  if (!actor.n3UserId) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_project_team_members")
    .select("project_id")
    .eq("tenant_id", actor.tenantRowId)
    .eq("n3_user_id", actor.n3UserId)
    .eq("is_active", true);
  if (error) return null;
  return data.map((row) => row.project_id);
}

export function seesEveryProject(actor: Actor): boolean {
  return actor.session.isOwner || canViewAllProjects(actor.role);
}

export async function listProjects(
  actor: Actor,
  query: z.infer<typeof projectListQuerySchema>,
): Promise<{ ok: true; rows: unknown[]; total: number; page: number; pageSize: number } | Fail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let scopedIds: string[] | null = null;
  if (!seesEveryProject(actor)) {
    scopedIds = await assignedProjectIds(actor);
    if (scopedIds === null) return { ok: false, status: 503, message: "Projects are unavailable" };
    if (scopedIds.length === 0) {
      return { ok: true, rows: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
  }

  let builder = supabaseAdmin
    .from("projecthub_projects")
    .select(PROJECT_COLUMNS, { count: "exact" })
    .eq("tenant_id", actor.tenantRowId);

  if (scopedIds) builder = builder.in("id", scopedIds);
  if (query.status) builder = builder.eq("status", query.status);
  if (query.projectType) builder = builder.eq("project_type", query.projectType);
  if (query.customerLinkStatus) builder = builder.eq("customer_link_status", query.customerLinkStatus);
  if (query.search) {
    const term = query.search.replace(/[%,()]/g, " ").trim();
    if (term) {
      builder = builder.or(
        [
          `enquiry_reference.ilike.%${term}%`,
          `title.ilike.%${term}%`,
          `n3_customer_name.ilike.%${term}%`,
          `requested_customer_name.ilike.%${term}%`,
        ].join(","),
      );
    }
  }

  const from = query.page * query.pageSize;
  const { data, error, count } = await builder
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1);

  if (error) return { ok: false, status: 503, message: "Projects are unavailable" };

  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  const phases = ids.length
    ? (
        await supabaseAdmin
          .from("projecthub_project_phases")
          .select("project_id, phase_kind, n3_project_code, requested_n3_project_code, link_status")
          .eq("tenant_id", actor.tenantRowId)
          .in("project_id", ids)
          .eq("phase_kind", "primary")
      ).data ?? []
    : [];

  const byProject = new Map(phases.map((p) => [p.project_id, p]));
  const rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown> & { id: string };
    const phase = byProject.get(r.id);
    return {
      ...r,
      primary_project_code: phase?.n3_project_code ?? phase?.requested_n3_project_code ?? null,
      primary_link_status: phase?.link_status ?? null,
    };
  });

  return { ok: true, rows, total: count ?? rows.length, page: query.page, pageSize: query.pageSize };
}

/** Tenant + visibility scoped fetch. Non-revealing 404 for anything else. */
export async function getProject(
  actor: Actor,
  projectId: string,
): Promise<{ ok: true; project: Record<string, unknown> } | Fail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_projects")
    .select(PROJECT_COLUMNS)
    .eq("tenant_id", actor.tenantRowId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { ok: false, status: 503, message: "Project is unavailable" };
  if (!data) return { ok: false, status: 404, message: "Not found" };

  if (!seesEveryProject(actor)) {
    const ids = await assignedProjectIds(actor);
    if (ids === null) return { ok: false, status: 503, message: "Project is unavailable" };
    if (!ids.includes(projectId)) return { ok: false, status: 404, message: "Not found" };
  }
  return { ok: true, project: data as Record<string, unknown> };
}

export async function getProjectWorkspace(actor: Actor, projectId: string) {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const scope = { tenant: actor.tenantRowId, project: projectId };

  const [phases, team, events, versions] = await Promise.all([
    supabaseAdmin
      .from("projecthub_project_phases")
      .select("*")
      .eq("tenant_id", scope.tenant)
      .eq("project_id", scope.project)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("projecthub_project_team_members")
      .select("*")
      .eq("tenant_id", scope.tenant)
      .eq("project_id", scope.project)
      .order("assigned_at", { ascending: true }),
    supabaseAdmin
      .from("projecthub_project_events")
      .select("id, event_type, entity_type, summary, metadata, actor_n3_user_id, occurred_at")
      .eq("tenant_id", scope.tenant)
      .eq("project_id", scope.project)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("projecthub_boq_versions")
      .select("*")
      .eq("tenant_id", scope.tenant)
      .eq("project_id", scope.project)
      .order("version_number", { ascending: false }),
  ]);

  return {
    ok: true as const,
    workspace: {
      project: found.project,
      phases: phases.data ?? [],
      team: team.data ?? [],
      events: events.data ?? [],
      boqVersions: versions.data ?? [],
      capabilities: {
        canEdit: roleHasPermission(actor.role, "projecthub:projects:edit"),
        canCancel: roleHasPermission(actor.role, "projecthub:projects:cancel"),
        canManageTeam: roleHasPermission(actor.role, "projecthub:projects:manage_team"),
        canEditBoq: roleHasPermission(actor.role, "projecthub:boq:edit"),
        canCloneBoq: roleHasPermission(actor.role, "projecthub:boq:clone"),
      },
    },
  };
}

export async function recordEvent(
  actor: Actor,
  projectId: string,
  event: {
    eventType: string;
    entityType?: string;
    entityId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("projecthub_project_events").insert({
    tenant_id: actor.tenantRowId,
    project_id: projectId,
    actor_n3_user_id: actor.n3UserId,
    event_type: event.eventType,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    summary: event.summary.slice(0, 300),
    metadata: (event.metadata ?? {}) as Json,
    correlation_id: actor.correlationId,
  });
}

export async function createEnquiry(
  actor: Actor,
  input: z.infer<typeof createProjectSchema>,
): Promise<{ ok: true; projectId: string; enquiryReference: string; replayed: boolean } | Fail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { clientRequestId, customer, primaryProjectCode, initialTeamN3UserIds, ...rest } = input;
  const payloadForHash = { ...rest, customer, primaryProjectCode, initialTeamN3UserIds };
  const hash = await hashPayload(payloadForHash);

  const payload = {
    client_request_id: clientRequestId,
    client_request_hash: hash,
    title: input.title,
    project_type: input.projectType,
    budget_mode: input.budgetMode,
    enquiry_date: input.enquiryDate,
    expected_start_date: input.expectedStartDate,
    expected_end_date: input.expectedEndDate,
    description: input.description,
    site_address_line1: input.siteAddressLine1,
    site_address_line2: input.siteAddressLine2,
    site_city: input.siteCity,
    site_state: input.siteState,
    site_postcode: input.sitePostcode,
    site_country: input.siteCountry,
    simple_budget_cost: input.budgetMode === "simple_budget" ? input.simpleBudgetCost : null,
    simple_budget_selling: input.budgetMode === "simple_budget" ? input.simpleBudgetSelling : null,
    customer_link_status: customer.customerLinkStatus,
    n3_customer_id: customer.n3CustomerId,
    n3_customer_code: customer.n3CustomerCode,
    n3_customer_name: customer.n3CustomerName,
    requested_customer_name: customer.requestedCustomerName,
    requested_customer_contact: customer.requestedCustomerContact,
    requested_customer_email: customer.requestedCustomerEmail,
    requested_customer_phone: customer.requestedCustomerPhone,
    primary_phase_name: input.primaryPhaseName ?? "Main contract",
    primary_link_status: primaryProjectCode.linkStatus,
    n3_project_id: primaryProjectCode.n3ProjectId,
    n3_project_code: primaryProjectCode.n3ProjectCode,
    n3_project_name: primaryProjectCode.n3ProjectName,
    requested_n3_project_code: primaryProjectCode.requestedN3ProjectCode,
    requested_n3_project_name: primaryProjectCode.requestedN3ProjectName,
  };

  const { data, error } = await supabaseAdmin.rpc("projecthub_create_enquiry", {
    p_tenant_id: actor.tenantRowId,
    p_year: new Date().getUTCFullYear(),
    p_actor: actor.n3UserId as unknown as string,
    p_correlation_id: actor.correlationId,
    p_payload: payload as unknown as Json,
  });

  if (error) {
    if ((error.message ?? "").includes("projecthub_idempotency_conflict")) {
      return { ok: false, status: 409, message: "This request id was already used with a different payload" };
    }
    return { ok: false, status: 503, message: "The enquiry could not be created" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { project_id: string; enquiry_reference: string; replayed: boolean }
    | undefined;
  if (!row) return { ok: false, status: 503, message: "The enquiry could not be created" };

  return {
    ok: true,
    projectId: row.project_id,
    enquiryReference: row.enquiry_reference,
    replayed: row.replayed,
  };
}

export async function updateProject(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof updateProjectSchema>,
): Promise<{ ok: true; project: Record<string, unknown> } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  if (found.project["status"] === "cancelled_lost") {
    return { ok: false, status: 422, message: "A cancelled project is read-only" };
  }

  const start = input.expectedStartDate ?? (found.project["expected_start_date"] as string | null);
  const end = input.expectedEndDate ?? (found.project["expected_end_date"] as string | null);
  if (start && end && start > end) {
    return { ok: false, status: 400, message: "The expected end date must not precede the start date" };
  }

  const patch: Record<string, unknown> = { updated_by_n3_user_id: actor.n3UserId };
  const map: Record<string, unknown> = {
    title: input.title,
    project_type: input.projectType,
    budget_mode: input.budgetMode,
    enquiry_date: input.enquiryDate,
    expected_start_date: input.expectedStartDate,
    expected_end_date: input.expectedEndDate,
    description: input.description,
    site_address_line1: input.siteAddressLine1,
    site_address_line2: input.siteAddressLine2,
    site_city: input.siteCity,
    site_state: input.siteState,
    site_postcode: input.sitePostcode,
    site_country: input.siteCountry,
    simple_budget_cost: input.simpleBudgetCost,
    simple_budget_selling: input.simpleBudgetSelling,
  };
  for (const [key, value] of Object.entries(map)) if (value !== undefined) patch[key] = value;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_projects")
    .update(patch as never)
    .eq("tenant_id", actor.tenantRowId)
    .eq("id", projectId)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The project could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "project.updated",
    entityType: "project",
    entityId: projectId,
    summary: "Project details updated",
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_by_n3_user_id") },
  });
  return { ok: true, project: data as Record<string, unknown> };
}

export async function cancelProject(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof cancelProjectSchema>,
): Promise<{ ok: true; project: Record<string, unknown> } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  if (found.project["status"] === "cancelled_lost") {
    return { ok: false, status: 409, message: "This project is already cancelled" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_projects")
    .update({
      status: "cancelled_lost",
      cancellation_reason: input.reason,
      cancellation_note: input.note,
      cancelled_at: new Date().toISOString(),
      updated_by_n3_user_id: actor.n3UserId,
    })
    .eq("tenant_id", actor.tenantRowId)
    .eq("id", projectId)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The project could not be cancelled" };

  await recordEvent(actor, projectId, {
    eventType: "project.cancelled",
    entityType: "project",
    entityId: projectId,
    summary: "Project marked Cancelled / Lost",
    metadata: { reason: input.reason.slice(0, 200) },
  });
  return { ok: true, project: data as Record<string, unknown> };
}

export async function createPhase(
  actor: Actor,
  projectId: string,
  input: z.infer<typeof createPhaseSchema>,
): Promise<{ ok: true; phase: Record<string, unknown> } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_project_phases")
    .insert({
      tenant_id: actor.tenantRowId,
      project_id: projectId,
      phase_kind: "secondary",
      phase_name: input.phaseName,
      sort_order: input.sortOrder,
      link_status: input.linkStatus,
      n3_project_id: input.n3ProjectId,
      n3_project_code: input.n3ProjectCode,
      n3_project_name: input.n3ProjectName,
      requested_n3_project_code: input.requestedN3ProjectCode,
      requested_n3_project_name: input.requestedN3ProjectName,
      expected_start_date: input.expectedStartDate,
      expected_end_date: input.expectedEndDate,
      created_by_n3_user_id: actor.n3UserId,
      updated_by_n3_user_id: actor.n3UserId,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, status: 409, message: "The phase could not be added — the N3 project code may already be in use" };
  }
  await recordEvent(actor, projectId, {
    eventType: "phase.created",
    entityType: "project_phase",
    entityId: data.id,
    summary: `Phase added: ${input.phaseName}`,
    metadata: { linkStatus: input.linkStatus },
  });
  return { ok: true, phase: data as Record<string, unknown> };
}

export async function updatePhase(
  actor: Actor,
  projectId: string,
  phaseId: string,
  input: z.infer<typeof updatePhaseSchema>,
): Promise<{ ok: true; phase: Record<string, unknown> } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: current } = await supabaseAdmin
    .from("projecthub_project_phases")
    .select("id, phase_kind, n3_project_id, is_active")
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", phaseId)
    .maybeSingle();
  if (!current) return { ok: false, status: 404, message: "Not found" };

  if (current.phase_kind === "primary" && input.isActive === false) {
    return { ok: false, status: 422, message: "The primary phase must stay active" };
  }

  const patch: Record<string, unknown> = { updated_by_n3_user_id: actor.n3UserId };
  const map: Record<string, unknown> = {
    phase_name: input.phaseName,
    sort_order: input.sortOrder,
    is_active: input.isActive,
    expected_start_date: input.expectedStartDate,
    expected_end_date: input.expectedEndDate,
  };
  if (!current.n3_project_id) {
    Object.assign(map, {
      link_status: input.linkStatus,
      n3_project_id: input.n3ProjectId,
      n3_project_code: input.n3ProjectCode,
      n3_project_name: input.n3ProjectName,
      requested_n3_project_code: input.requestedN3ProjectCode,
      requested_n3_project_name: input.requestedN3ProjectName,
    });
  }
  for (const [key, value] of Object.entries(map)) if (value !== undefined) patch[key] = value;

  const { data, error } = await supabaseAdmin
    .from("projecthub_project_phases")
    .update(patch as never)
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("id", phaseId)
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 409, message: "The phase could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "phase.updated",
    entityType: "project_phase",
    entityId: phaseId,
    summary: `Phase updated: ${data.phase_name}`,
  });
  return { ok: true, phase: data as Record<string, unknown> };
}

export async function assignTeamMember(
  actor: Actor,
  projectId: string,
  targetN3UserId: string,
  display: { displayName?: string | null; displayEmail?: string | null },
): Promise<{ ok: true; member: Record<string, unknown> } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // The target must already hold an active ProjectHub role in THIS tenant.
  const { data: roleRow } = await supabaseAdmin
    .from("projecthub_user_roles")
    .select("role, is_active")
    .eq("tenant_id", actor.tenantRowId)
    .eq("n3_user_id", targetN3UserId)
    .maybeSingle();
  if (!roleRow || !roleRow.is_active || roleRow.role === "unassigned") {
    return { ok: false, status: 422, message: "That user needs an active ProjectHub role first" };
  }

  const { data, error } = await supabaseAdmin
    .from("projecthub_project_team_members")
    .upsert(
      {
        tenant_id: actor.tenantRowId,
        project_id: projectId,
        n3_user_id: targetN3UserId,
        display_name: display.displayName ?? null,
        display_email: display.displayEmail ?? null,
        project_role_snapshot: roleRow.role,
        is_active: true,
        assigned_by_n3_user_id: actor.n3UserId,
      },
      { onConflict: "tenant_id,project_id,n3_user_id" },
    )
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 503, message: "The team member could not be saved" };

  await recordEvent(actor, projectId, {
    eventType: "team.assigned",
    entityType: "team_member",
    entityId: data.id,
    summary: `Team member assigned (${roleRow.role})`,
  });
  return { ok: true, member: data as Record<string, unknown> };
}

/** Soft deactivation only — ProjectHub never physically deletes membership. */
export async function deactivateTeamMember(
  actor: Actor,
  projectId: string,
  targetN3UserId: string,
): Promise<{ ok: true } | Fail> {
  const found = await getProject(actor, projectId);
  if (!found.ok) return found;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_project_team_members")
    .update({ is_active: false })
    .eq("tenant_id", actor.tenantRowId)
    .eq("project_id", projectId)
    .eq("n3_user_id", targetN3UserId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 503, message: "The team member could not be updated" };
  if (!data) return { ok: false, status: 404, message: "Not found" };

  await recordEvent(actor, projectId, {
    eventType: "team.deactivated",
    entityType: "team_member",
    entityId: data.id,
    summary: "Team member deactivated",
  });
  return { ok: true };
}
