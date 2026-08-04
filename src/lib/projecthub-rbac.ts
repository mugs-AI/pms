/**
 * Central ProjectHub role/permission mapping.
 *
 * Browser-safe: contains no secrets and no tenant data. The UI uses it to hide
 * what the user cannot do; the SERVER enforcement in
 * src/lib/projecthub-actor.server.ts is the only authority.
 *
 * `owner` is never granted by this table — it comes exclusively from live N3
 * `CompanyProfile/BasicInfo.isOwner === true`.
 */

export const PROJECTHUB_ROLES = [
  "owner",
  "project_manager",
  "estimator",
  "finance",
  "procurement",
  "storekeeper",
  "site_supervisor",
  "viewer",
  "unassigned",
] as const;

export type ProjectHubRole = (typeof PROJECTHUB_ROLES)[number];

/** Roles an Owner may assign. `owner` is deliberately absent. */
export const ASSIGNABLE_ROLES = PROJECTHUB_ROLES.filter((r) => r !== "owner");

export const ROLE_LABELS: Record<ProjectHubRole, string> = {
  owner: "Owner / Admin",
  project_manager: "Project Manager",
  estimator: "Estimator",
  finance: "Finance",
  procurement: "Procurement",
  storekeeper: "Storekeeper",
  site_supervisor: "Site Supervisor",
  viewer: "Viewer",
  unassigned: "Unassigned",
};

export const PERMISSIONS = [
  "projecthub:roles:manage",
  "projecthub:projects:list",
  "projecthub:projects:create",
  "projecthub:projects:view_all",
  "projecthub:projects:view_assigned",
  "projecthub:projects:edit",
  "projecthub:projects:manage_team",
  "projecthub:projects:cancel",
  "projecthub:boq:view",
  "projecthub:boq:edit",
  "projecthub:boq:clone",
  "projecthub:n3:customers:read",
  "projecthub:n3:projects:read",
  "projecthub:n3:stocks:read",
  "projecthub:n3:taxcodes:read",
  "projecthub:n3:users:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<ProjectHubRole, readonly Permission[]> = {
  // Live N3 Owner: everything available in Milestone 1A.
  owner: PERMISSIONS,
  project_manager: [
    "projecthub:projects:list",
    "projecthub:projects:create",
    "projecthub:projects:view_assigned",
    "projecthub:projects:edit",
    "projecthub:projects:manage_team",
    "projecthub:projects:cancel",
    "projecthub:boq:view",
    "projecthub:boq:edit",
    "projecthub:boq:clone",
    "projecthub:n3:customers:read",
    "projecthub:n3:projects:read",
    "projecthub:n3:stocks:read",
    "projecthub:n3:taxcodes:read",
    "projecthub:n3:users:read",
  ],
  estimator: [
    "projecthub:projects:list",
    "projecthub:projects:view_assigned",
    "projecthub:boq:view",
    "projecthub:boq:edit",
    "projecthub:boq:clone",
    "projecthub:n3:stocks:read",
    "projecthub:n3:taxcodes:read",
  ],
  // Finance sees every tenant project and its commercial values, read-only.
  finance: [
    "projecthub:projects:list",
    "projecthub:projects:view_all",
    "projecthub:boq:view",
  ],
  procurement: [
    "projecthub:projects:list",
    "projecthub:projects:view_assigned",
    "projecthub:boq:view",
  ],
  storekeeper: [
    "projecthub:projects:list",
    "projecthub:projects:view_assigned",
    "projecthub:boq:view",
  ],
  site_supervisor: ["projecthub:projects:list", "projecthub:projects:view_assigned"],
  viewer: ["projecthub:projects:list", "projecthub:projects:view_assigned"],
  // No ProjectHub business data at all.
  unassigned: [],
};

export function permissionsForRole(role: ProjectHubRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function roleHasPermission(role: ProjectHubRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}

/** Roles that may list every project in the tenant rather than only assigned ones. */
export function canViewAllProjects(role: ProjectHubRole): boolean {
  return roleHasPermission(role, "projecthub:projects:view_all");
}

export function isProjectHubRole(value: unknown): value is ProjectHubRole {
  return typeof value === "string" && (PROJECTHUB_ROLES as readonly string[]).includes(value);
}
