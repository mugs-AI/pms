/**
 * The single ProjectHub date field.
 *
 * Visible order is ALWAYS Malaysian `DD/MM/YYYY` — the component renders the
 * text itself, so no browser or OS locale can turn it into `MM/DD/YYYY`.
 * The value crossing the API/database boundary is always ISO `YYYY-MM-DD`.
 */
import { useEffect, useId, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayDateToIso, isValidDisplayDate, isoToDisplayDate } from "@/lib/projecthub-date";

export type MalaysianDateInputProps = {
  id: string;
  /** ISO `YYYY-MM-DD`, or empty when unset. */
  value: string;
  /** Receives ISO `YYYY-MM-DD`, or `""` when cleared or not yet valid. */
  onChange: (iso: string) => void;
  /** True while the typed text is non-empty but not a real `DD/MM/YYYY` day. */
  onInvalidChange?: (invalid: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
  inputRef?: (node: HTMLInputElement | null) => void;
  ariaLabel?: string | undefined;
};

function isoToDate(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function dateToIso(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function MalaysianDateInput({
  id,
  value,
  onChange,
  onInvalidChange,
  disabled,
  readOnly,
  invalid,
  describedBy,
  inputRef,
  ariaLabel,
}: MalaysianDateInputProps) {
  const [text, setText] = useState(() => isoToDisplayDate(value));
  const [open, setOpen] = useState(false);
  const localRef = useRef<HTMLInputElement | null>(null);
  const popoverId = useId();

  // Round-trips an externally loaded ISO value without changing the stored day.
  useEffect(() => {
    const incoming = isoToDisplayDate(value);
    setText((current) => (displayDateToIso(current) === (value || null) ? current : incoming));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (raw: string) => {
    const trimmed = raw.trim();
    const iso = displayDateToIso(trimmed);
    onInvalidChange?.(trimmed.length > 0 && iso === null);
    onChange(iso ?? "");
  };

  const handleText = (raw: string) => {
    // Digits and slashes only; the incomplete entry is retained while typing.
    const cleaned = raw.replace(/[^\d/]/g, "").slice(0, 10);
    setText(cleaned);
    emit(cleaned);
  };

  const selectFromCalendar = (date: Date | undefined) => {
    if (!date) return;
    const iso = dateToIso(date);
    setText(isoToDisplayDate(iso));
    onInvalidChange?.(false);
    onChange(iso);
    setOpen(false);
    localRef.current?.focus();
  };

  const selected = isoToDate(displayDateToIso(text) ?? value);

  return (
    <div className="flex items-stretch gap-2">
      <input
        id={id}
        ref={(node) => {
          localRef.current = node;
          inputRef?.(node);
        }}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        aria-label={ariaLabel}
        aria-invalid={invalid || (text.trim().length > 0 && !isValidDisplayDate(text)) || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        readOnly={readOnly}
        value={text}
        onChange={(event) => handleText(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || readOnly}
            aria-label="Open calendar"
            aria-controls={popoverId}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input px-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent id={popoverId} className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={selected}
            {...(selected ? { defaultMonth: selected } : {})}
            onSelect={selectFromCalendar}
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
