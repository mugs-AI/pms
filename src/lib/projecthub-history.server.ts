/**
 * WP0E canonical ProjectHub history: the single server-owned event writer and
 * the shared tenant-scoped read model used by Project History, Global History
 * and the XLSX export. Every query carries the server-resolved tenant.
 */
import type { Json } from "@/integrations/supabase/types";
import type { Actor } from "./projecthub-actor.server";
import {
  deriveModuleAction,
  encodeCursor,
  HISTORY_ACTIONS,
  HISTORY_MODULES,
  HISTORY_OUTCOMES,
  legacyEventTypesForAction,
  legacyEventTypesForModule,
  redactValues,
  type HistoryAction,
  type HistoryModule,
  type HistoryOutcome,
  type HistoryPage,
  type HistoryQuery,
  type HistoryRow,
} from "./projecthub-history";

type Fail = { ok: false; status: number; message: string };

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export type HistoryEventInput = {
  eventType: string;
  entityType?: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  module?: HistoryModule;
  action?: HistoryAction;
  outcome?: HistoryOutcome;
  phaseId?: string | null;
  entityKey?: string | null;
  entityReference?: string | null;
  entityTitle?: string | null;
  reason?: string | null;
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  relatedEventId?: string | null;
};

const clip = (value: string | null | undefined, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Builds the full insert row. Pure apart from the supplied snapshots. */
export function buildEventRow(
  actor: Actor,
  projectId: string,
  event: HistoryEventInput,
  snapshots: {
    projectReference: string | null;
    projectTitle: string | null;
    actorName: string | null;
    actorRole: string | null;
    phaseName: string | null;
  },
) {
  const derived = deriveModuleAction(event.eventType);
  const module = (HISTORY_MODULES as readonly string[]).includes(event.module ?? "")
    ? (event.module as HistoryModule)
    : derived.module;
  const action = (HISTORY_ACTIONS as readonly string[]).includes(event.action ?? "")
    ? (event.action as HistoryAction)
    : derived.action;
  const outcome = (HISTORY_OUTCOMES as readonly string[]).includes(event.outcome ?? "")
    ? (event.outcome as HistoryOutcome)
    : "succeeded";
  const changed = (event.changedFields ?? [])
    .filter((f) => typeof f === "string" && /^[A-Za-z0-9_.]{1,60}$/.test(f))
    .slice(0, 50);
  const metadata = redactValues(event.metadata ?? {}) ?? {};
  return {
    tenant_id: actor.tenantRowId,
    project_id: projectId,
    actor_n3_user_id: actor.n3UserId,
    event_type: event.eventType.slice(0, 80),
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    summary: event.summary.slice(0, 300),
    metadata: metadata as Json,
    correlation_id: actor.correlationId,
    schema_version: 2,
    actor_type: actor.n3UserId ? "human" : "system",
    actor_display_name_snapshot: clip(snapshots.actorName, 200),
    actor_role_snapshot: clip(snapshots.actorRole, 40),
    project_reference_snapshot: clip(snapshots.projectReference, 40),
    project_title_snapshot: clip(snapshots.projectTitle, 300),
    phase_id: event.phaseId ?? null,
    phase_name_snapshot: clip(snapshots.phaseName, 200),
    module,
    action,
    outcome,
    source_system: "ProjectHub",
    reason: clip(event.reason, 500),
    entity_key: clip(event.entityKey, 120),
    entity_reference_snapshot: clip(event.entityReference, 120),
    entity_title_snapshot: clip(event.entityTitle, 300),
    changed_fields: changed.length ? changed : null,
    before_values: redactValues(event.before) as Json | null,
    after_values: redactValues(event.after) as Json | null,
    related_event_id: event.relatedEventId ?? null,
  };
}

/**
 * The single ProjectHub business-event writer. Tenant, actor and every
 * snapshot are derived server-side; the target project must belong to the
 * actor's tenant or nothing is written.
 */
export async function writeHistoryEvent(
  actor: Actor,
  projectId: string,
  event: HistoryEventInput,
): Promise<{ ok: true } | Fail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: project } = await supabaseAdmin
    .from("projecthub_projects")
    .select("id, enquiry_reference, title")
    .eq("tenant_id", actor.tenantRowId)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, status: 404, message: "Not found" };

  let actorName: string | null = actor.session.displayName ?? actor.session.email ?? null;
  if (actor.n3UserId) {
    const { data: role } = await supabaseAdmin
      .from("projecthub_user_roles")
      .select("display_name, display_email")
      .eq("tenant_id", actor.tenantRowId)
      .eq("n3_user_id", actor.n3UserId)
      .maybeSingle();
    actorName = role?.display_name ?? role?.display_email ?? actorName;
  }

  let phaseName: string | null = null;
  const phaseId =
    event.phaseId ?? (event.entityType === "project_phase" ? (event.entityId ?? null) : null);
  if (phaseId) {
    const { data: phase } = await supabaseAdmin
      .from("projecthub_project_phases")
      .select("phase_name")
      .eq("tenant_id", actor.tenantRowId)
      .eq("project_id", projectId)
      .eq("id", phaseId)
      .maybeSingle();
    phaseName = phase?.phase_name ?? null;
  }

  const row = buildEventRow(
    actor,
    projectId,
    { ...event, phaseId: phaseName ? phaseId : null },
    {
      projectReference: (project as { enquiry_reference: string }).enquiry_reference,
      projectTitle: (project as { title: string }).title,
      actorName,
      actorRole: actor.role,
      phaseName,
    },
  );
  const { error } = await supabaseAdmin.from("projecthub_project_events").insert(row);
  if (error) return { ok: false, status: 503, message: "History could not be recorded" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const EVENT_COLUMNS =
  "id, tenant_id, project_id, actor_n3_user_id, event_type, entity_type, entity_id, summary, correlation_id, occurred_at, sequence_no, schema_version, recorded_at, actor_type, actor_display_name_snapshot, actor_role_snapshot, project_reference_snapshot, project_title_snapshot, phase_id, phase_name_snapshot, module, action, outcome, source_system, reason, entity_key, entity_reference_snapshot, entity_title_snapshot, document_type, document_id, document_number_snapshot, changed_fields, before_values, after_values, related_event_id";

type EventRecord = Record<string, unknown> & {
  id: string;
  project_id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
  correlation_id: string;
};

const SORT_COLUMN = { occurredAt: "occurred_at", title: "summary", eventType: "event_type" };

/** Quotes a value for a PostgREST logical-filter expression. */
export function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Case-insensitive contains pattern with LIKE wildcards escaped. */
export function containsPattern(term: string): string {
  return `*${term.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "")}*`;
}

function ilikeExpr(column: string, term: string): string {
  return `${column}.ilike.${pgQuote(containsPattern(term))}`;
}

/** Minimal chainable builder surface we rely on (keeps the real type out). */
type Builder = {
  eq: (c: string, v: unknown) => Builder;
  gte: (c: string, v: unknown) => Builder;
  lt: (c: string, v: unknown) => Builder;
  is: (c: string, v: unknown) => Builder;
  not: (c: string, op: string, v: unknown) => Builder;
  contains: (c: string, v: unknown) => Builder;
  or: (expr: string) => Builder;
  order: (c: string, o: { ascending: boolean }) => Builder;
  limit: (n: number) => Builder;
  then: PromiseLike<{ data: unknown[] | null; error: unknown }>["then"];
};

async function idsMatching(
  table: "projecthub_user_roles" | "projecthub_projects" | "projecthub_project_phases",
  tenant: string,
  columns: string[],
  idColumn: string,
  term: string,
): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin.from(table).select(idColumn) as unknown as Builder)
    .eq("tenant_id", tenant)
    .or(columns.map((c) => ilikeExpr(c, term)).join(","))
    .limit(500);
  return ((data ?? []) as Record<string, string>[])
    .map((r) => r[idColumn])
    .filter((v): v is string => typeof v === "string");
}

const inList = (values: string[]) => `(${values.map(pgQuote).join(",")})`;

/** Applies scope + every filter. Returns a list of human-readable filter notes. */
async function applyFilters(
  actor: Actor,
  query: HistoryQuery,
  builder: Builder,
): Promise<{ builder: Builder; applied: string[] }> {
  let b = builder.eq("tenant_id", actor.tenantRowId);
  const applied: string[] = [];
  if (query.scope === "project" && query.projectId) b = b.eq("project_id", query.projectId);
  const f = query.filters;
  if (query.fromUtc) {
    b = b.gte("occurred_at", query.fromUtc);
    applied.push(`From ${f.dateFrom}`);
  }
  if (query.toUtcExclusive) {
    b = b.lt("occurred_at", query.toUtcExclusive);
    applied.push(`To ${f.dateTo}`);
  }
  const t = f.text;
  if (t.actor) {
    const ids = await idsMatching(
      "projecthub_user_roles",
      actor.tenantRowId,
      ["display_name", "display_email"],
      "n3_user_id",
      t.actor,
    );
    const parts = [ilikeExpr("actor_display_name_snapshot", t.actor)];
    if (ids.length) parts.push(`actor_n3_user_id.in.${inList(ids)}`);
    b = b.or(parts.join(","));
    applied.push("User");
  }
  if (t.title) {
    b = b.or(ilikeExpr("summary", t.title));
    applied.push("Title");
  }
  if (t.project) {
    const ids = await idsMatching(
      "projecthub_projects",
      actor.tenantRowId,
      ["enquiry_reference", "title"],
      "id",
      t.project,
    );
    const parts = [
      ilikeExpr("project_reference_snapshot", t.project),
      ilikeExpr("project_title_snapshot", t.project),
    ];
    if (ids.length) parts.push(`project_id.in.${inList(ids)}`);
    b = b.or(parts.join(","));
    applied.push("Project");
  }
  if (t.phase) {
    const ids = await idsMatching(
      "projecthub_project_phases",
      actor.tenantRowId,
      ["phase_name"],
      "id",
      t.phase,
    );
    const parts = [ilikeExpr("phase_name_snapshot", t.phase)];
    if (ids.length) {
      parts.push(`phase_id.in.${inList(ids)}`);
      parts.push(`and(entity_type.eq.project_phase,entity_id.in.${inList(ids)})`);
    }
    b = b.or(parts.join(","));
    applied.push("Phase");
  }
  const simpleText: [keyof typeof t, string, string][] = [
    ["eventType", "event_type", "Event Type"],
    ["entityType", "entity_type", "Entity Type"],
    ["entityReference", "entity_reference_snapshot", "Entity Reference"],
    ["entityTitle", "entity_title_snapshot", "Entity Title"],
    ["reason", "reason", "Reason"],
    ["documentType", "document_type", "Document Type"],
    ["documentNumber", "document_number_snapshot", "Document Number"],
  ];
  for (const [param, column, label] of simpleText) {
    const term = t[param];
    if (!term) continue;
    b = b.or(ilikeExpr(column, term));
    applied.push(label);
  }
  if (t.changedField) {
    b = b.contains("changed_fields", [t.changedField]);
    applied.push("Changed Fields");
  }
  const e = f.enums;
  if (e.module) {
    const legacy = legacyEventTypesForModule(e.module);
    b = b.or(
      [
        `module.eq.${pgQuote(e.module)}`,
        ...(legacy.length ? [`and(module.is.null,event_type.in.${inList(legacy)})`] : []),
      ].join(","),
    );
    applied.push(`Module: ${e.module}`);
  }
  if (e.action) {
    const legacy = legacyEventTypesForAction(e.action);
    b = b.or(
      [
        `action.eq.${pgQuote(e.action)}`,
        ...(legacy.length ? [`and(action.is.null,event_type.in.${inList(legacy)})`] : []),
      ].join(","),
    );
    applied.push(`Action: ${e.action}`);
  }
  if (e.outcome) {
    b =
      e.outcome === "succeeded"
        ? b.or("outcome.eq.succeeded,outcome.is.null")
        : b.eq("outcome", e.outcome);
    applied.push(`Outcome: ${e.outcome}`);
  }
  if (e.sourceSystem) {
    b =
      e.sourceSystem === "ProjectHub"
        ? b.or(`source_system.eq.ProjectHub,source_system.is.null`)
        : b.eq("source_system", e.sourceSystem);
    applied.push(`Source: ${e.sourceSystem}`);
  }
  if (f.uuids.correlationId) {
    b = b.eq("correlation_id", f.uuids.correlationId);
    applied.push("Correlation ID");
  }
  if (f.uuids.eventId) {
    b = b.eq("id", f.uuids.eventId);
    applied.push("Event ID");
  }
  if (f.legacyDerived !== undefined) {
    b = f.legacyDerived ? b.is("schema_version", null) : b.not("schema_version", "is", null);
    applied.push(`Legacy: ${f.legacyDerived ? "Yes" : "No"}`);
  }
  return { builder: b, applied };
}

function applyKeyset(query: HistoryQuery, b: Builder, cursor = query.cursor): Builder {
  if (!cursor) return b;
  const col = SORT_COLUMN[query.sortKey];
  const op = query.sortDirection === "desc" ? "lt" : "gt";
  return b.or(
    `${col}.${op}.${pgQuote(cursor.v)},and(${col}.eq.${pgQuote(cursor.v)},id.${op}.${cursor.id})`,
  );
}

/** Maps raw records to rows, coalescing legacy labels from current data. */
async function toRows(actor: Actor, records: EventRecord[]): Promise<HistoryRow[]> {
  const legacy = records.filter((r) => r["schema_version"] == null);
  const projectLabels = new Map<string, { ref: string; title: string }>();
  const actorLabels = new Map<string, string>();
  const phaseLabels = new Map<string, string>();
  if (legacy.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const projectIds = [...new Set(legacy.map((r) => r.project_id))];
    const actorIds = [
      ...new Set(legacy.map((r) => r["actor_n3_user_id"]).filter(Boolean) as string[]),
    ];
    const phaseIds = [
      ...new Set(
        legacy
          .filter((r) => r["entity_type"] === "project_phase" && r["entity_id"])
          .map((r) => r["entity_id"] as string),
      ),
    ];
    const [projects, actors, phases] = await Promise.all([
      supabaseAdmin
        .from("projecthub_projects")
        .select("id, enquiry_reference, title")
        .eq("tenant_id", actor.tenantRowId)
        .in("id", projectIds),
      actorIds.length
        ? supabaseAdmin
            .from("projecthub_user_roles")
            .select("n3_user_id, display_name, display_email")
            .eq("tenant_id", actor.tenantRowId)
            .in("n3_user_id", actorIds)
        : Promise.resolve({ data: [] as Record<string, string | null>[] }),
      phaseIds.length
        ? supabaseAdmin
            .from("projecthub_project_phases")
            .select("id, phase_name")
            .eq("tenant_id", actor.tenantRowId)
            .in("id", phaseIds)
        : Promise.resolve({ data: [] as Record<string, string | null>[] }),
    ]);
    for (const p of (projects.data ?? []) as Record<string, string>[]) {
      projectLabels.set(p["id"] as string, {
        ref: p["enquiry_reference"] as string,
        title: p["title"] as string,
      });
    }
    for (const a of (actors.data ?? []) as Record<string, string | null>[]) {
      actorLabels.set(a["n3_user_id"] as string, (a["display_name"] ?? a["display_email"]) || "");
    }
    for (const ph of (phases.data ?? []) as Record<string, string | null>[]) {
      phaseLabels.set(ph["id"] as string, ph["phase_name"] ?? "");
    }
  }

  return records.map((r) => {
    const isLegacy = r["schema_version"] == null;
    const derived = deriveModuleAction(r.event_type);
    const str = (k: string) => (typeof r[k] === "string" && r[k] ? (r[k] as string) : null);
    const label = projectLabels.get(r.project_id);
    const actorId = str("actor_n3_user_id");
    const phaseFallback =
      isLegacy && r["entity_type"] === "project_phase"
        ? (phaseLabels.get(r["entity_id"] as string) ?? null)
        : null;
    return {
      eventId: r.id,
      projectId: r.project_id,
      occurredAt: r.occurred_at,
      recordedAt: str("recorded_at"),
      user:
        str("actor_display_name_snapshot") ??
        (actorId ? (actorLabels.get(actorId) ?? null) : null) ??
        (actorId ? "Unavailable user" : "System"),
      title: r.summary,
      project:
        str("project_title_snapshot") ?? label?.title ?? (isLegacy ? "Project unavailable" : null),
      projectReference: str("project_reference_snapshot") ?? label?.ref ?? null,
      module: str("module") ?? derived.module,
      action: str("action") ?? derived.action,
      outcome: str("outcome") ?? "succeeded",
      phase: str("phase_name_snapshot") ?? phaseFallback,
      eventType: r.event_type,
      entityType: str("entity_type"),
      entityReference: str("entity_reference_snapshot"),
      entityTitle: str("entity_title_snapshot"),
      source: str("source_system") ?? "ProjectHub",
      reason: str("reason"),
      documentType: str("document_type"),
      documentNumber: str("document_number_snapshot"),
      changedFields: Array.isArray(r["changed_fields"]) ? (r["changed_fields"] as string[]) : [],
      correlationId: r.correlation_id,
      legacyDerived: isLegacy,
      details: {
        before: redactValues(r["before_values"] as Record<string, unknown> | null),
        after: redactValues(r["after_values"] as Record<string, unknown> | null),
      },
    };
  });
}

function cursorFor(query: HistoryQuery, record: EventRecord) {
  const col = SORT_COLUMN[query.sortKey];
  return { k: query.sortKey, d: query.sortDirection, v: String(record[col]), id: record.id };
}

async function fetchBatch(
  actor: Actor,
  query: HistoryQuery,
  size: number,
  cursor = query.cursor,
): Promise<{ records: EventRecord[]; applied: string[] } | Fail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const base = supabaseAdmin
    .from("projecthub_project_events")
    .select(EVENT_COLUMNS) as unknown as Builder;
  const { builder, applied } = await applyFilters(actor, query, base);
  const ascending = query.sortDirection === "asc";
  const { data, error } = await applyKeyset(query, builder, cursor)
    .order(SORT_COLUMN[query.sortKey], { ascending })
    .order("id", { ascending })
    .limit(size);
  if (error) return { ok: false, status: 503, message: "History is unavailable" };
  return { records: (data ?? []) as EventRecord[], applied };
}

/** One page of history for the grid. */
export async function queryHistory(
  actor: Actor,
  query: HistoryQuery,
): Promise<({ ok: true } & HistoryPage) | Fail> {
  const batch = await fetchBatch(actor, query, query.limit + 1);
  if ("ok" in batch) return batch;
  const hasMore = batch.records.length > query.limit;
  const page = batch.records.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    ok: true,
    rows: await toRows(actor, page),
    nextCursor: hasMore && last ? encodeCursor(cursorFor(query, last)) : null,
    pageSize: query.limit,
    // A cheap, exact total is not available through keyset pagination.
    total: null,
    appliedFilters: batch.applied,
  };
}

/**
 * Every authorised filtered row for export, in the active sort. Returns
 * `tooMany` without rows when the cap would be exceeded.
 */
export async function collectHistoryForExport(
  actor: Actor,
  query: HistoryQuery,
  cap: number,
): Promise<
  | { ok: true; rows: HistoryRow[]; applied: string[] }
  | { ok: false; status: number; message: string; tooMany?: boolean }
> {
  const out: EventRecord[] = [];
  let cursor: HistoryQuery["cursor"] = null;
  let applied: string[] = [];
  const BATCH = 1000;
  for (;;) {
    const batch = await fetchBatch(actor, { ...query, cursor }, BATCH, cursor);
    if ("ok" in batch) return batch;
    applied = batch.applied;
    out.push(...batch.records);
    if (out.length > cap) {
      return {
        ok: false,
        status: 422,
        tooMany: true,
        message: `More than ${cap.toLocaleString("en-MY")} rows match. Refine the filters and export again.`,
      };
    }
    if (batch.records.length < BATCH) break;
    const last = batch.records[batch.records.length - 1] as EventRecord;
    cursor = cursorFor(query, last);
  }
  return { ok: true, rows: await toRows(actor, out), applied };
}
