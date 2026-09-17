import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  getWorkspaceCapMessage,
  mostRecentWorkspaceTab,
  openNewEnquiryWorkspace,
  openProjectWorkspace,
  removeWorkspaceTab,
  type ProjectSection,
  useWorkspaceTabs,
} from "@/lib/workspace-tabs";

export type ActiveWorkspace =
  | { kind: "new" }
  | {
      kind: "project";
      projectId: string;
      section: ProjectSection;
      reference?: string;
      title?: string;
    };

export function WorkspaceTabs({ active }: { active?: ActiveWorkspace }) {
  const tabs = useWorkspaceTabs();
  const navigate = useNavigate();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeKey =
    active?.kind === "new"
      ? "new-enquiry"
      : active?.kind === "project"
        ? `project:${active.projectId}`
        : null;

  useEffect(() => {
    if (active?.kind === "new") openNewEnquiryWorkspace();
    if (active?.kind === "project") {
      openProjectWorkspace({
        projectId: active.projectId,
        reference: active.reference ?? "Project",
        title: active.title ?? "Project workspace",
        section: active.section,
      });
    }
  }, [
    active?.kind,
    active?.kind === "project" ? active.projectId : "",
    active?.kind === "project" ? active.reference : "",
    active?.kind === "project" ? active.title : "",
    active?.kind === "project" ? active.section : "",
  ]);

  if (tabs.length === 0) return null;
  const capMessage = getWorkspaceCapMessage();

  const close = async (key: string, index: number) => {
    const tab = tabs.find((item) => item.key === key);
    if (!tab) return;
    if (tab.dirty && !window.confirm("Discard this unfinished enquiry?")) return;
    const wasActive = key === activeKey;
    removeWorkspaceTab(key);
    if (wasActive) {
      const next = mostRecentWorkspaceTab();
      if (!next) await navigate({ to: "/projects" });
      else if (next.projectId)
        await navigate({
          to: "/projects/$projectId",
          params: { projectId: next.projectId },
          search: { section: next.section },
        });
      else await navigate({ to: "/projects/new" });
    } else {
      refs.current[Math.max(0, index - 1)]?.focus();
    }
  };

  return (
    <div className="border-t border-primary-foreground/10 bg-primary" aria-label="Open workspaces">
      <div className="overflow-x-auto px-4 sm:px-6 lg:px-8">
        <div
          role="tablist"
          aria-label="Open project workspaces"
          className="flex min-w-max items-stretch gap-1 py-1.5"
        >
          {tabs.map((tab, index) => {
            const selected = tab.key === activeKey;
            const label = tab.projectId ? `${tab.reference} · ${tab.title}` : "New Enquiry";
            const linkClass = `inline-flex min-h-10 max-w-64 items-center truncate rounded-l-md px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${selected ? "bg-background text-foreground" : "text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground"}`;
            return (
              <div key={tab.key} className="flex shrink-0 items-stretch" title={label}>
                {tab.projectId ? (
                  <Link
                    ref={(node) => {
                      refs.current[index] = node;
                    }}
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    to="/projects/$projectId"
                    params={{ projectId: tab.projectId }}
                    search={{ section: tab.section }}
                    className={linkClass}
                    onKeyDown={(event) => {
                      let target = index;
                      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
                      else if (event.key === "ArrowLeft")
                        target = (index - 1 + tabs.length) % tabs.length;
                      else if (event.key === "Home") target = 0;
                      else if (event.key === "End") target = tabs.length - 1;
                      else return;
                      event.preventDefault();
                      refs.current[target]?.focus();
                    }}
                  >
                    {label}
                  </Link>
                ) : (
                  <Link
                    ref={(node) => {
                      refs.current[index] = node;
                    }}
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    to="/projects/new"
                    className={linkClass}
                  >
                    {label}
                  </Link>
                )}
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={() => void close(tab.key, index)}
                  className={`min-h-10 rounded-r-md px-2 text-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${selected ? "bg-background text-muted-foreground hover:text-foreground" : "text-primary-foreground/65 hover:bg-primary-foreground/10 hover:text-primary-foreground"}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {capMessage ? (
        <p role="status" className="px-4 pb-2 text-xs text-primary-foreground sm:px-6 lg:px-8">
          {capMessage}
        </p>
      ) : null}
    </div>
  );
}
