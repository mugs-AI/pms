import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearToken,
  emailFromJwt,
  fetchN3Session,
  getToken,
  setToken,
  N3Error,
} from "./n3-client";

export type SessionState = {
  status: "loading" | "anonymous" | "authenticated" | "error";
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
  /** Server-resolved from live N3 BasicInfo. Never from a JWT claim. */
  isOwner: boolean;
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
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [tenantCode, setTenantCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const signIn = useCallback((token: string, expiration?: string | null) => {
    setToken(token, expiration ?? null);
    setTick((t) => t + 1);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setCompanyName(null);
    setTenantCode(null);
    setEmail(null);
    setIsOwner(false);
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
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
    );
    setTick((t) => t + 1);
  }, []);

  // Session identity is resolved server-side on every authenticated load.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setStatus("anonymous");
      return;
    }
    setStatus("loading");
    // Display-only fallback until the server answers.
    setEmail(emailFromJwt(token));

    fetchN3Session()
      .then((dto) => {
        if (cancelled) return;
        setCompanyName(dto.companyName);
        setTenantCode(dto.tenantCode);
        setEmail(dto.email ?? emailFromJwt(token));
        setIsOwner(dto.isOwner === true);
        setError(null);
        setStatus("authenticated");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not reach N3";
        const status401 = e instanceof N3Error && e.status === 401;
        setIsOwner(false);
        setError(message);
        setStatus(status401 || !getToken() ? "anonymous" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      companyName,
      tenantCode,
      email,
      isOwner,
      error,
      signIn,
      signOut,
    }),
    [status, companyName, tenantCode, email, isOwner, error, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
