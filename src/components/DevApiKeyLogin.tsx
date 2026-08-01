import { useState } from "react";
import { useSession } from "@/lib/n3-session";

/** Dev-only Path B sign-in. Never rendered in production builds. */
export function DevApiKeyLogin() {
  const { signIn } = useSession();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!import.meta.env.DEV) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const body = (await res.json().catch(() => null)) as {
        token?: string;
        expiration?: string | null;
        message?: string;
      } | null;
      if (!res.ok || !body?.token) {
        setError(body?.message ?? `Connect failed (${res.status})`);
        return;
      }
      setApiKey("");
      signIn(body.token, body.expiration ?? null);
    } catch {
      setError("Could not reach the connect endpoint");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-5 shadow-card">
      <h2 className="text-sm font-semibold tracking-wide text-accent uppercase">
        Development only — API key login
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Local testing path. The key is exchanged server-side and never stored.
      </p>
      <label htmlFor="n3-api-key" className="mt-4 block text-sm font-medium text-foreground">
        N3 API key
      </label>
      <input
        id="n3-api-key"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        placeholder="Paste the API key from My Apps"
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || apiKey.trim().length === 0}
        className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect with API key"}
      </button>
    </form>
  );
}
