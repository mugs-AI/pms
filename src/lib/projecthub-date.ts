/**
 * Malaysia (Asia/Kuala_Lumpur) calendar helpers.
 *
 * ProjectHub is a Malaysian construction product: the enquiry calendar day and
 * the ENQ-YYYY sequence year must follow Malaysia local time, never UTC and
 * never the browser's own zone. Both the browser and the server use these
 * helpers so they can never disagree around midnight.
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
