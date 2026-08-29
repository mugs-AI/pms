/**
 * Malaysia (Asia/Kuala_Lumpur) calendar helpers — the single ProjectHub date
 * standard.
 *
 * Display is always `DD/MM/YYYY` (dates) and `DD/MM/YYYY HH:mm` (timestamps,
 * 24-hour, Asia/Kuala_Lumpur), independent of the browser or OS locale.
 * Storage, form values and API contracts remain ISO: `YYYY-MM-DD` for
 * date-only values and ISO timestamps for instants. Date-only values are
 * never routed through a UTC `Date` conversion that could shift the day.
 */
export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MALAYSIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's Malaysia calendar date as `yyyy-MM-dd`. */
export function malaysiaToday(now: Date = new Date()): string {
  return formatter.format(now);
}

/** The Malaysia calendar year, e.g. 2026 at 00:30 MYT on 1 January 2026. */
export function malaysiaYear(now: Date = new Date()): number {
  return Number(malaysiaToday(now).slice(0, 4));
}

/**
 * The year used for `ENQ-YYYY-#####`.
 * A validated enquiry date wins; otherwise the Malaysia calendar year is used.
 */
export function enquiryReferenceYear(
  enquiryDate: string | null | undefined,
  now: Date = new Date(),
): number {
  if (enquiryDate && /^\d{4}-\d{2}-\d{2}$/.test(enquiryDate)) {
    return Number(enquiryDate.slice(0, 4));
  }
  return malaysiaYear(now);
}

/* ------------------------------------------------------------------ */
/* Calendar validation (pure, no Date/UTC round-trip)                  */
/* ------------------------------------------------------------------ */

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] as number;
}

/** True for a real calendar day written as ISO `YYYY-MM-DD`. */
export function isValidIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** True for a real calendar day written as Malaysian `DD/MM/YYYY`. */
export function isValidDisplayDate(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return false;
  return isValidIsoDate(`${match[3]}-${match[2]}-${match[1]}`);
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY`. No timezone conversion happens. */
export function isoToDisplayDate(value: string | null | undefined): string {
  if (!isValidIsoDate(value)) return "";
  const [year, month, day] = value.trim().split("-");
  return `${day}/${month}/${year}`;
}

/** `DD/MM/YYYY` → ISO `YYYY-MM-DD`, or `null` when the entry is not a real day. */
export function displayDateToIso(value: string | null | undefined): string | null {
  if (!isValidDisplayDate(value)) return null;
  const [day, month, year] = value.trim().split("/");
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Display formatting                                                  */
/* ------------------------------------------------------------------ */

const timestampParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALAYSIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Formats an ISO date-only value for display. Empty input renders as `—`. */
export function formatMalaysianDate(value: string | null | undefined, fallback = "—"): string {
  const display = isoToDisplayDate(value);
  return display || fallback;
}

/**
 * Formats an ISO timestamp as `DD/MM/YYYY HH:mm` in Asia/Kuala_Lumpur,
 * regardless of the runtime timezone or locale.
 */
export function formatMalaysianDateTime(value: string | null | undefined, fallback = "—"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return fallback;
  const parts = timestampParts.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  if (!day || !month || !year) return fallback;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** Compares two validated ISO date-only values without any Date conversion. */
export function isoDateBefore(a: string, b: string): boolean {
  return a < b;
}
