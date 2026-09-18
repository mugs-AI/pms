import { useEffect, useRef } from "react";
import type { SessionState } from "@/lib/n3-session";
import { clearWorkspaceTabs } from "@/lib/workspace-tabs";

export function useWorkspaceLifecycle(session: SessionState): void {
  const tenant = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (session.status === "anonymous" || session.status === "error") clearWorkspaceTabs();
    if (session.status === "authenticated") {
      if (tenant.current !== undefined && tenant.current !== session.tenantCode) clearWorkspaceTabs();
      tenant.current = session.tenantCode;
    }
  }, [session.status, session.tenantCode]);
}