/**
 * Shared ProjectHub presentation primitives: access states, async states and
 * the N3-backed searchable picker. No business authority lives here.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-wide break-words text-foreground sm:text-3xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 [&>*]:min-h-11 [&>*]:inline-flex [&>*]:items-center">
          {actions}
        </div>
      ) : null}
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
        <div key={index} className="h-12 rounded-md bg-muted motion-safe:animate-pulse" />
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
  inputRef?: (node: HTMLInputElement | null) => void;
};

/**
 * Keyboard-complete combobox fed exclusively by sanitized same-origin N3 reads.
 *
 * The browser sends the selected immutable id only; the server re-resolves the
 * record and owns every stored snapshot, so a tampered selection cannot
 * introduce a fabricated display identity.
 */
export function N3Picker({
  kind,
  label,
  value,
  onChange,
  disabled,
  error,
  placeholder,
  inputRef,
}: N3PickerProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const errorId = `${baseId}-error`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useN3Picker(kind, debounced, open && !disabled);
  const options = useMemo(() => query.data?.options ?? [], [query.data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const select = (option: PickerOption) => {
    onChange(option);
    setOpen(false);
    setSearch("");
  };

  const move = (delta: number) => {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case "Home":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter": {
        if (!open) break;
        event.preventDefault();
        const option = options[activeIndex];
        if (option) select(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const incomplete = query.data?.completeness === "incomplete";

  const status = query.isLoading
    ? "Searching N3\u2026"
    : query.isError
      ? describeError(query.error).message
      : options.length === 0
        ? incomplete
          ? "Search incomplete \u2014 N3 did not return a complete searchable set. Refine the search or retry."
          : "No matching N3 records"
        : null;

  // Completeness state: more matches exist than this bounded page can show,
  // so the user is told to refine the search instead of being left with a
  // silently truncated list.
  const truncated = query.data?.hasMore === true && options.length > 0;


  return (
    <div className="space-y-1">
      <span
        id={labelId}
        className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
      >
        {label}
      </span>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="truncate">
            {value.code ? `${value.code} \u2014 ` : ""}
            {value.name ?? value.id}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="min-h-11 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            aria-activedescendant={open && options.length > 0 ? optionId(activeIndex) : undefined}
            className={`${inputClass} focus-visible:ring-2 focus-visible:ring-ring`}
            placeholder={placeholder ?? "Search live N3 records"}
            value={search}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            hidden={!open}
            className="max-h-56 w-full overflow-y-auto overscroll-contain rounded-md border border-border bg-card text-sm"
          >
            {status ? (
              <li
                role="presentation"
                aria-live="polite"
                className={`px-3 py-2 ${query.isError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {status}
              </li>
            ) : null}
            {options.map((option, index) => {
              const active = index === activeIndex;
              return (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  data-active={active ? "true" : "false"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`cursor-pointer px-3 py-2 ${active ? "bg-secondary" : ""}`}
                >
                  <span className="font-medium">
                    {option.code ? `${option.code} \u2014 ` : ""}
                    {option.name ?? option.id}
                  </span>
                  {option.detail ? (
                    <span className="block text-xs text-muted-foreground">{option.detail}</span>
                  ) : null}
                </li>
              );
            })}
            {truncated ? (
              <li
                role="presentation"
                className="border-t border-border px-3 py-2 text-xs text-muted-foreground"
              >
                Showing the first {options.length} matches — refine your search to narrow the list.
              </li>
            ) : null}
          </ul>
        </>
      )}
      {error ? (
        <span id={errorId} role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
