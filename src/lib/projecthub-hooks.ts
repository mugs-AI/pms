/**
 * TanStack Query bindings for the same-origin ProjectHub API.
 * Reads and mutations all flow through `projectHubRequest`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectHubRequest } from "./projecthub-client";
import type { ProjectHubRole } from "./projecthub-rbac";

export const qk = {
  session: ["projecthub", "session"] as const,
  roles: (search: string) => ["projecthub", "roles", search] as const,
  dashboard: ["projecthub", "dashboard"] as const,
  teamCandidates: ["projecthub", "team-candidates"] as const,
  projects: (params: Record<string, unknown>) => ["projecthub", "projects", params] as const,
  project: (id: string) => ["projecthub", "project", id] as const,
  boq: (id: string, versionId?: string) =>
    ["projecthub", "boq", id, versionId ?? "latest"] as const,
  quotation: (id: string) => ["projecthub", "quotation", id] as const,
  picker: (kind: string, search: string) => ["projecthub", "n3", kind, search] as const,
};

export type PickerOption = {
  id: string;
  code: string | null;
  name: string | null;
  detail: string | null;
  rate: string | null;
};

export type ProjectRow = {
  id: string;
  enquiry_reference: string;
  title: string;
  project_type: string;
  status: string;
  budget_mode: string;
  enquiry_date: string | null;
  expected_start_date: string | null;
  expected_end_date: string | null;
  description: string | null;
  site_address_line1: string | null;
  site_address_line2: string | null;
  site_city: string | null;
  site_state: string | null;
  site_postcode: string | null;
  site_country: string | null;
  customer_link_status: string;
  n3_customer_id: string | null;
  n3_customer_code: string | null;
  n3_customer_name: string | null;
  requested_customer_name: string | null;
  requested_customer_contact: string | null;
  requested_customer_email: string | null;
  requested_customer_phone: string | null;
  simple_budget_cost: string | null;
  simple_budget_selling: string | null;
  currency_code: string | null;
  cancellation_reason: string | null;
  cancellation_note: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  primary_project_code?: string | null;
  primary_link_status?: string | null;
};

export type PhaseRow = {
  id: string;
  phase_kind: string;
  phase_name: string;
  sort_order: number;
  is_active: boolean;
  link_status: string;
  n3_project_id: string | null;
  n3_project_code: string | null;
  n3_project_name: string | null;
  requested_n3_project_code: string | null;
  requested_n3_project_name: string | null;
  expected_start_date: string | null;
  expected_end_date: string | null;
};

export type TeamRow = {
  id: string;
  n3_user_id: string;
  display_name: string | null;
  display_email: string | null;
  project_role_snapshot: string | null;
  is_active: boolean;
  assigned_at: string;
};

export type EventRow = {
  id: string;
  event_type: string;
  entity_type: string | null;
  summary: string;
  actor_n3_user_id: string | null;
  occurred_at: string;
};

export type BoqVersionRow = {
  id: string;
  version_number: number;
  revision_label: string | null;
  status: string;
  notes: string | null;
  source_version_id?: string | null;
  created_at: string;
};

export type BoqSectionRow = {
  id: string;
  code: string | null;
  name: string;
  sort_order: number;
};

export type BoqItemRow = {
  id: string;
  section_id: string | null;
  project_phase_id: string;
  line_number: number;
  item_type: string;
  description: string;
  quantity: string;
  n3_uom_id: string | null;
  uom_code: string | null;
  uom_name: string | null;
  cost_rate: string;
  selling_rate: string;
  n3_tax_code_id: string | null;
  tax_code: string | null;
  tax_rate: string | null;
  n3_stock_id: string | null;
  stock_code: string | null;
  stock_name: string | null;
  stock_deduction_method: string | null;
  notes: string | null;
};

export type Workspace = {
  project: ProjectRow;
  phases: PhaseRow[];
  team: TeamRow[];
  events: EventRow[];
  boqVersions: BoqVersionRow[];
  capabilities: {
    canEdit: boolean;
    canCancel: boolean;
    canManageTeam: boolean;
    canEditBoq: boolean;
    canCloneBoq: boolean;
  };
};

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

export function useN3Picker(kind: string, search: string, enabled = true) {
  return useQuery({
    queryKey: qk.picker(kind, search),
    enabled,
    queryFn: () =>
      projectHubRequest<{ options: PickerOption[]; total: number }>(`n3/${kind}`, {
        query: { search, pageSize: 50 },
      }),
  });
}

export function useRoleDirectory(search: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.roles(search),
    enabled,
    queryFn: () =>
      projectHubRequest<{ entries: RoleDirectoryEntry[]; n3DirectoryAvailable: boolean }>("roles", {
        query: { search },
      }),
  });
}

export type DashboardRecentRow = {
  id: string;
  enquiry_reference: string;
  title: string;
  status: string;
  project_type: string;
  updated_at: string;
};

export type DashboardDto = {
  total: number;
  enquiries: number;
  active: number;
  cancelled: number;
  recent: DashboardRecentRow[];
};

/** Tenant-scoped, permission-aware dashboard aggregate. */
export function useDashboard(enabled: boolean) {
  return useQuery({
    queryKey: qk.dashboard,
    enabled,
    queryFn: () => projectHubRequest<{ dashboard: DashboardDto }>("projects/dashboard"),
  });
}

export type TeamCandidate = {
  n3UserId: string;
  displayName: string | null;
  displayEmail: string | null;
  role: string;
};

/** Server-owned candidate list: active tenant users with a ProjectHub role. */
export function useTeamCandidates(enabled: boolean) {
  return useQuery({
    queryKey: qk.teamCandidates,
    enabled,
    queryFn: () => projectHubRequest<{ candidates: TeamCandidate[] }>("projects/team-candidates"),
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { n3UserId: string; role: ProjectHubRole; isActive: boolean }) =>
      projectHubRequest<{ entry: unknown }>(`roles/${encodeURIComponent(input.n3UserId)}`, {
        method: "PATCH",
        body: { role: input.role, isActive: input.isActive },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projecthub", "roles"] });
    },
  });
}

export type ProjectListParams = {
  search?: string;
  status?: string;
  projectType?: string;
  page: number;
  pageSize: number;
};

export function useProjects(params: ProjectListParams, enabled: boolean) {
  return useQuery({
    queryKey: qk.projects(params as unknown as Record<string, unknown>),
    enabled,
    queryFn: () =>
      projectHubRequest<{ rows: ProjectRow[]; total: number; page: number; pageSize: number }>(
        "projects",
        { query: params as Record<string, string | number | undefined> },
      ),
  });
}

export function useProjectWorkspace(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.project(projectId),
    enabled,
    queryFn: () => projectHubRequest<{ workspace: Workspace }>(`projects/${projectId}`),
  });
}

export function useBoq(projectId: string, versionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.boq(projectId, versionId),
    enabled,
    queryFn: () =>
      projectHubRequest<{
        boq: {
          versions: BoqVersionRow[];
          version: BoqVersionRow | null;
          sections: BoqSectionRow[];
          items: BoqItemRow[];
          summary: unknown;
        };
      }>(`projects/${projectId}/boq`, { query: { versionId } }),
  });
}

/** Generic project-scoped mutation that refreshes the workspace and BOQ. */
export function useProjectMutation<TInput>(
  projectId: string,
  request: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["projecthub", "boq", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projecthub", "projects"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Read-only customer quotation preview
// ---------------------------------------------------------------------------

export type QuotationLine = {
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

export type QuotationSection = {
  code: string | null;
  name: string;
  lines: QuotationLine[];
  subtotal: { selling: string; tax: string; total: string };
};

export type QuotationDto = {
  previewGeneratedAt: string;
  postingState: "not_posted";
  notPostedToN3Label: string;
  previewReady: boolean;
  futurePostingReady: boolean;
  blockers: { code: string; scope: "preview" | "future_posting"; message: string }[];
  document: {
    enquiryReference: string;
    projectTitle: string;
    customerDisplayName: string;
    siteDescription: string | null;
    revisionLabel: string;
    primaryPhaseName: string;
    currency: string;
    sections: QuotationSection[];
    totals: { selling: string; tax: string; total: string };
  } | null;
};

/** Server-derived, privacy-minimized quotation readiness and preview. */
export function useQuotationPreview(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.quotation(projectId),
    enabled,
    queryFn: () =>
      projectHubRequest<{ quotation: QuotationDto }>(`projects/${projectId}/quotation-preview`),
  });
}
