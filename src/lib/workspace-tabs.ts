import { useSyncExternalStore } from "react";

export type ProjectSection = "overview" | "phases" | "team" | "activity" | "budget" | "quotation";
export type WorkspaceTab = {
  key: string;
  projectId: string | null;
  reference: string;
  title: string;
  section: ProjectSection;
  lastUsed: number;
  dirty?: boolean;
};

export const PROJECT_SECTIONS: ProjectSection[] = [
  "overview",
  "phases",
  "team",
  "activity",
  "budget",
  "quotation",
];
export const WORKSPACE_TAB_LIMIT = 8;

let tabs: WorkspaceTab[] = [];
let counter = 0;
let capMessage: string | null = null;
const listeners = new Set<() => void>();
const EMPTY_TABS: WorkspaceTab[] = [];

function emit() {
  listeners.forEach((listener) => listener());
}
function nextUse() {
  counter += 1;
  return counter;
}

export function normaliseSection(value: unknown): ProjectSection {
  return typeof value === "string" && PROJECT_SECTIONS.includes(value as ProjectSection)
    ? (value as ProjectSection)
    : "overview";
}

export function getWorkspaceTabs(): WorkspaceTab[] {
  return tabs;
}
export function getWorkspaceCapMessage(): string | null {
  return capMessage;
}
export function subscribeWorkspaceTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useWorkspaceTabs(): WorkspaceTab[] {
  return useSyncExternalStore(subscribeWorkspaceTabs, getWorkspaceTabs, () => EMPTY_TABS);
}

export function openProjectWorkspace(
  input: Omit<WorkspaceTab, "key" | "lastUsed" | "dirty">,
): boolean {
  const key = `project:${input.projectId}`;
  const existing = tabs.find((tab) => tab.key === key);
  if (!existing && tabs.filter((tab) => tab.projectId).length >= WORKSPACE_TAB_LIMIT) {
    capMessage = `Up to ${WORKSPACE_TAB_LIMIT} projects can be open. Close a project tab before opening another.`;
    emit();
    return false;
  }
  capMessage = null;
  tabs = existing
    ? tabs.map((tab) => (tab.key === key ? { ...tab, ...input, lastUsed: nextUse() } : tab))
    : [...tabs, { key, ...input, lastUsed: nextUse() }];
  emit();
  return true;
}

export function openNewEnquiryWorkspace(): void {
  const existing = tabs.find((tab) => tab.key === "new-enquiry");
  tabs = existing
    ? tabs.map((tab) => (tab.key === existing.key ? { ...tab, lastUsed: nextUse() } : tab))
    : [
        ...tabs,
        {
          key: "new-enquiry",
          projectId: null,
          reference: "New Enquiry",
          title: "New Enquiry",
          section: "overview",
          lastUsed: nextUse(),
          dirty: false,
        },
      ];
  emit();
}

export function setNewEnquiryDirty(dirty: boolean): void {
  if (tabs.find((tab) => tab.key === "new-enquiry")?.dirty === dirty) return;
  tabs = tabs.map((tab) => (tab.key === "new-enquiry" ? { ...tab, dirty } : tab));
  emit();
}

export function removeWorkspaceTab(key: string): WorkspaceTab | null {
  const removed = tabs.find((tab) => tab.key === key) ?? null;
  tabs = tabs.filter((tab) => tab.key !== key);
  emit();
  return removed;
}

export function mostRecentWorkspaceTab(): WorkspaceTab | null {
  return [...tabs].sort((a, b) => b.lastUsed - a.lastUsed)[0] ?? null;
}

export function clearWorkspaceTabs(): void {
  tabs = [];
  capMessage = null;
  counter = 0;
  emit();
}

export function replaceNewEnquiryWithProject(
  input: Omit<WorkspaceTab, "key" | "lastUsed" | "dirty">,
): void {
  tabs = tabs.filter((tab) => tab.key !== "new-enquiry");
  openProjectWorkspace(input);
}

export function resetWorkspaceTabsForTests(): void {
  clearWorkspaceTabs();
}
