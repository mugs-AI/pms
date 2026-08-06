/**
 * Shared ProjectHub presentation primitives: access states, async states and
 * the N3-backed searchable picker. No business authority lives here.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { describeError } from "@/lib/projecthub-client";
import { useN3Picker, type PickerOption } from "@/lib/projecthub-hooks";
import { useSession } from "@/lib/n3-session";

export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { message, correlationId } = describeError(error);
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-semibold text-destructive">{message}</p>
      {correlationId ? (
        <p className="mt-1 text-xs text-muted-foreground">Support reference: {correlationId}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
      <h2 className="font-display text-lg font-bold tracking-wide text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Distinct copy per non-working access state, per the accepted contract. */
export function AccessState() {
  const { roleStatus, roleLabel } = useSession();
  if (roleStatus === "disabled") {
    return (
      <Card>
        <h2 className="font-display text-lg font-bold text-foreground">
          ProjectHub access disabled
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your ProjectHub access has been deactivated. Ask your N3 account owner to reactivate it.
        </p>
      </Card>
    );
  }
  if (roleStatus === "identity_missing") {
    return (
      <Card>
        <h2 className="font-display text-lg font-bold text-foreground">N3 identity incomplete</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your N3 session did not return a usable immutable user identity, so ProjectHub cannot
          resolve your access. Relaunch ProjectHub from N3 My Apps.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="font-display text-lg font-bold text-foreground">Role unassigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask your N3 account owner to assign a ProjectHub role.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Current role: {roleLabel}</p>
    </Card>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      {children}
      {hint && !error ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      {error ? (
        <span role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none";

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "success" | "destructive";
}) {
  const tones = {
    muted: "bg-secondary text-secondary-foreground",
    accent: "bg-accent/20 text-foreground",
    success: "bg-success/15 text-foreground",
    destructive: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export type N3PickerProps = {
  kind: "customers" | "projects" | "stocks" | "uoms" | "tax-codes" | "users";
  label: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
};

/** Searchable picker fed exclusively by sanitized same-origin N3 reads. */
export function N3Picker({
  kind,
  label,
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: N3PickerProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useN3Picker(kind, debounced, open && !disabled);
  const options = useMemo(() => query.data?.options ?? [], [query.data]);

  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="truncate">
            {value.code ? `${value.code} — ` : ""}
            {value.name ?? value.id}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            className={inputClass}
            placeholder={placeholder ?? "Search live N3 records"}
            value={search}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
          />
          {open ? (
            <ul
              id={listId}
              className="max-h-56 overflow-auto rounded-md border border-border bg-card text-sm"
            >
              {query.isLoading ? (
                <li className="px-3 py-2 text-muted-foreground">Searching N3…</li>
              ) : null}
              {query.isError ? (
                <li className="px-3 py-2 text-destructive">{describeError(query.error).message}</li>
              ) : null}
              {!query.isLoading && !query.isError && options.length === 0 ? (
                <li className="px-3 py-2 text-muted-foreground">No matching N3 records</li>
              ) : null}
              {options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-secondary"
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="font-medium">
                      {option.code ? `${option.code} — ` : ""}
                      {option.name ?? option.id}
                    </span>
                    {option.detail ? (
                      <span className="block text-xs text-muted-foreground">{option.detail}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? (
        <span role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
