import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  discardNewEnquiry,
  getWorkspaceCapMessage,
  mostRecentWorkspaceTab,
  openNewEnquiryWorkspace,
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
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const focusAfterClose = useRef<string | null>(null);
  const activeKey =
    active?.kind === "new"
      ? "new-enquiry"
      : active?.kind === "project"
        ? `project:${active.projectId}`
        : null;
  const activeKind = active?.kind;
  useEffect(() => {
    if (activeKind === "new") openNewEnquiryWorkspace();
  }, [activeKind]);

  useEffect(() => {
    const key = focusAfterClose.current;
    if (!key) return;
    refs.current.get(key)?.focus();
    focusAfterClose.current = null;
  }, [tabs]);

  if (tabs.length === 0) return null;
  const capMessage = getWorkspaceCapMessage();

  const close = async (key: string, index: number) => {
    const tab = tabs.find((item) => item.key === key);
    if (!tab) return;
    if (tab.key === "new-enquiry") {
      if (!discardNewEnquiry(() => window.confirm("Discard this unfinished enquiry?"))) return;
    } else {
      removeWorkspaceTab(key);
    }
    const wasActive = key === activeKey;
    if (wasActive) {
      const next = mostRecentWorkspaceTab();
      if (!next) await navigate({ to: "/projects" });
      else if (next.projectId) {
        focusAfterClose.current = next.key;
        await navigate({
          to: "/projects/$projectId",
          params: { projectId: next.projectId },
          search: { section: next.section },
        });
      } else {
        focusAfterClose.current = next.key;
        await navigate({ to: "/projects/new" });
      }
    } else {
      const next = tabs[index + 1] ?? tabs[index - 1];
      if (next) focusAfterClose.current = next.key;
    }
  };

  return (
    <nav className="border-t border-primary-foreground/10 bg-primary" aria-label="Open workspaces">
      <div className="overflow-x-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-max items-stretch gap-1 py-1.5">
          {tabs.map((tab, index) => {
            const selected = tab.key === activeKey;
            const label = tab.projectId ? `${tab.reference} · ${tab.title}` : "New Enquiry";
            const linkClass = `inline-flex min-h-10 max-w-64 items-center truncate rounded-l-md px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${selected ? "bg-background text-foreground" : "text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground"}`;
            return (
              <div key={tab.key} className="flex shrink-0 items-stretch" title={label}>
                {tab.projectId ? (
                  <Link
                    ref={(node) => {
                      if (node) refs.current.set(tab.key, node);
                      else refs.current.delete(tab.key);
                    }}
                    aria-current={selected ? "page" : undefined}
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
                      else if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.click();
                        return;
                      } else return;
                      event.preventDefault();
                      const targetTab = tabs[target];
                      if (targetTab) refs.current.get(targetTab.key)?.focus();
                    }}
                  >
                    {label}
                  </Link>
                ) : (
                  <Link
                    ref={(node) => {
                      if (node) refs.current.set(tab.key, node);
                      else refs.current.delete(tab.key);
                    }}
                    aria-current={selected ? "page" : undefined}
                    to="/projects/new"
                    className={linkClass}
                    onKeyDown={(event) => {
                      let target = index;
                      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
                      else if (event.key === "ArrowLeft")
                        target = (index - 1 + tabs.length) % tabs.length;
                      else if (event.key === "Home") target = 0;
                      else if (event.key === "End") target = tabs.length - 1;
                      else if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.click();
                        return;
                      } else return;
                      event.preventDefault();
                      const targetTab = tabs[target];
                      if (targetTab) refs.current.get(targetTab.key)?.focus();
                    }}
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
    </nav>
  );
}
