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
  claimsFromJwt,
  clearToken,
  emailFromJwt,
  getToken,
  n3Get,
  setToken,
} from "./n3-client";

type BasicInfo = {
  companyName?: string;
  tenantCode?: string;
  tenantId?: string;
  isOwner?: boolean;
};

export type SessionState = {
  status: "loading" | "anonymous" | "authenticated" | "error";
  companyName: string | null;
  tenantCode: string | null;
  email: string | null;
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

  // Path A: pick up ?token= from a My Apps launch, then strip it from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setToken(urlToken);
      window.history.replaceState({}, "", window.location.pathname);
      setTick((t) => t + 1);
    }
  }, []);

  // Always refresh company/tenant from N3 on every authenticated load.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setStatus("anonymous");
      return;
    }
    setStatus("loading");
    setEmail(emailFromJwt(token));

    n3Get<BasicInfo>("api/CompanyProfile/BasicInfo")
      .then((info) => {
        if (cancelled) return;
        const claims = claimsFromJwt(token);
        setCompanyName(info?.companyName ?? null);
        setTenantCode(
          info?.tenantCode ?? (claims["tenantCode"] as string | undefined) ?? null,
        );
        setIsOwner(info?.isOwner === true || claims["isOwner"] === "true");
        setError(null);
        setStatus("authenticated");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Could not reach N3";
        if (!getToken()) {
          setStatus("anonymous");
          setError(message);
          return;
        }
        setError(message);
        setStatus("error");
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