/**
 * Owner-only ProjectHub role directory and assignment.
 * `owner` is never manually assignable — it comes only from live N3 BasicInfo.
 */
import type { Actor } from "./projecthub-actor.server";
import { auditAction } from "./projecthub-actor.server";
import { readPicker } from "./projecthub-n3.server";
import { ROLE_LABELS, type ProjectHubRole } from "./projecthub-rbac";
import type { assignRoleSchema } from "./projecthub-schemas";
import type { z } from "zod";

export type RoleDirectoryEntry = {
  n3UserId: string;
  displayName: string | null;
  displayEmail: string | null;
  role: ProjectHubRole;
  roleLabel: string;
  isActive: boolean;
  roleSource: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  inN3Directory: boolean;
};

/** Shows the N3 user identity without exposing the whole immutable id. */
export function maskUserId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export async function listRoleDirectory(
  actor: Actor,
  search?: string,
): Promise<{ ok: true; entries: RoleDirectoryEntry[]; n3DirectoryAvailable: boolean } | { ok: false; status: number; message: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projecthub_user_roles")
    .select("n3_user_id, display_name, display_email, role, is_active, role_source, assigned_at, assigned_by_n3_user_id")
    .eq("tenant_id", actor.tenantRowId)
    .order("display_name", { ascending: true });

  if (error) return { ok: false, status: 503, message: "Role directory is unavailable" };

  const stored = new Map(data.map((row) => [row.n3_user_id, row]));
  const picker = await readPicker(actor, "users", { search, page: 0, pageSize: 100 });
  const entries: RoleDirectoryEntry[] = [];
  const seen = new Set<string>();

  if (picker.ok) {
    for (const option of picker.options) {
      const row = stored.get(option.id);
      seen.add(option.id);
      entries.push({
        n3UserId: option.id,
        displayName: option.name ?? row?.display_name ?? null,
        displayEmail: option.detail ?? row?.display_email ?? null,
        role: (row?.role as ProjectHubRole) ?? "unassigned",
        roleLabel: ROLE_LABELS[(row?.role as ProjectHubRole) ?? "unassigned"],
        isActive: row?.is_active ?? true,
        roleSource: row?.role_source ?? null,
        assignedAt: row?.assigned_at ?? null,
        assignedBy: row?.assigned_by_n3_user_id ?? null,
        inN3Directory: true,
      });
    }
  }

  for (const row of data) {
    if (seen.has(row.n3_user_id)) continue;
    entries.push({
      n3UserId: row.n3_user_id,
      displayName: row.display_name,
      displayEmail: row.display_email,
      role: row.role as ProjectHubRole,
      roleLabel: ROLE_LABELS[row.role as ProjectHubRole],
      isActive: row.is_active,
      roleSource: row.role_source,
      assignedAt: row.assigned_at,
      assignedBy: row.assigned_by_n3_user_id,
      inN3Directory: false,
    });
  }

  return { ok: true, entries, n3DirectoryAvailable: picker.ok };
}

export async function assignRole(
  actor: Actor,
  targetN3UserId: string,
  input: z.infer<typeof assignRoleSchema>,
): Promise<{ ok: true; entry: { n3UserId: string; role: ProjectHubRole; isActive: boolean } } | { ok: false; status: number; message: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Owner is never manually assignable, in any spelling.
  if ((input.role as string) === "owner") {
    return { ok: false, status: 403, message: "Owner authority comes only from N3" };
  }

  const { data: existing, error: readError } = await supabaseAdmin
    .from("projecthub_user_roles")
    .select("role, is_active")
    .eq("tenant_id", actor.tenantRowId)
    .eq("n3_user_id", targetN3UserId)
    .maybeSingle();
  if (readError) return { ok: false, status: 503, message: "Role directory is unavailable" };

  const isActive = input.isActive ?? true;
  const { error } = await supabaseAdmin.from("projecthub_user_roles").upsert(
    {
      tenant_id: actor.tenantRowId,
      n3_user_id: targetN3UserId,
      display_name: input.displayName ?? null,
      display_email: input.displayEmail ?? null,
      role: input.role,
      role_source: "owner_assigned",
      is_active: isActive,
      assigned_by_n3_user_id: actor.n3UserId,
      assigned_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,n3_user_id" },
  );

  if (error) {
    await auditAction(actor, {
      eventType: "roles",
      action: "assign_role",
      outcome: "failed",
      targetType: "n3_user",
      targetIdentity: maskUserId(targetN3UserId),
      metadata: { requestedRole: input.role },
    });
    return { ok: false, status: 503, message: "The role could not be saved" };
  }

  await auditAction(actor, {
    eventType: "roles",
    action: "assign_role",
    outcome: "succeeded",
    targetType: "n3_user",
    targetIdentity: maskUserId(targetN3UserId),
    metadata: {
      previousRole: existing?.role ?? null,
      previousActive: existing?.is_active ?? null,
      newRole: input.role,
      newActive: isActive,
    },
  });

  return { ok: true, entry: { n3UserId: targetN3UserId, role: input.role, isActive } };
}
