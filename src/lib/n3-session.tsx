import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearToken, emailFromJwt, getToken, setToken } from "./n3-client";
import { fetchProjectHubSession, ProjectHubError, type ProjectHubSession } from "./projecthub-client";
import type { Permission, ProjectHubRole } from "./projecthub-rbac";

export type SessionState = {
  status: "loading" | "anonymous" | "authenticated" | "error";
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
  displayName: string | null;
  /** Server-resolved from live N3 BasicInfo. Never from a JWT claim. */
  isOwner: boolean;
  projectHubRole: ProjectHubRole;
  roleLabel: string;
  roleStatus: ProjectHubSession["roleStatus"];
  permissions: Permission[];
  hasPermission: (permission: Permission) => boolean;
  refreshSession: () => void;
  error: string | null;
  signIn: (token: string, expiration?: string | null) => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [session, setSession] = useState<ProjectHubSession | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refreshSession = useCallback(() => setTick((t) => t + 1), []);

  const signIn = useCallback((token: string, expiration?: string | null) => {
    setToken(token, expiration ?? null);
    setTick((t) => t + 1);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setSession(null);
    setFallbackEmail(null);
    setError(null);
    setStatus("anonymous");
  }, []);

  // Path A: pick up ?token= from a My Apps launch, then strip ONLY that
  // parameter while preserving other query parameters and the hash.
  useEffect(() => {
    const url = new URL(window.location.href);
    const urlToken = url.searchParams.get("token");
    if (!urlToken) return;
    const expiration = url.searchParams.get("expiration");
    setToken(urlToken, expiration);
    url.searchParams.delete("token");
    url.searchParams.delete("expiration");
    const search = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`);
    setTick((t) => t + 1);
  }, []);

  // Effective identity, role and permissions are resolved server-side on every
  // authenticated load. The browser never derives authority locally.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setStatus("anonymous");
      return;
    }
    setStatus("loading");
    setFallbackEmail(emailFromJwt(token));

    fetchProjectHubSession()
      .then((dto) => {
        if (cancelled) return;
        setSession(dto);
        setError(null);
        setStatus("authenticated");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not reach N3";
        const unauthenticated = e instanceof ProjectHubError && e.status === 401;
        setSession(null);
        setError(message);
        setStatus(unauthenticated || !getToken() ? "anonymous" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const value = useMemo<SessionState>(() => {
    const permissions = session?.permissions ?? [];
    return {
      status,
      companyName: session?.companyName ?? null,
      tenantCode: session?.tenantCode ?? null,
      email: session?.email ?? fallbackEmail,
      displayName: session?.displayName ?? null,
      isOwner: session?.isOwner === true,
      projectHubRole: session?.projectHubRole ?? "unassigned",
      roleLabel: session?.roleLabel ?? "Role unassigned",
      roleStatus: session?.roleStatus ?? "unassigned",
      permissions,
      hasPermission: (permission: Permission) => permissions.includes(permission),
      refreshSession,
      error,
      signIn,
      signOut,
    };
  }, [status, session, fallbackEmail, error, refreshSession, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
