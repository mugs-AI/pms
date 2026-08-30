/**
 * WP0B Part B — Malaysian date standard.
 *
 * Display is always DD/MM/YYYY (and DD/MM/YYYY HH:mm for timestamps) in
 * Asia/Kuala_Lumpur, while every stored/transported value stays ISO.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  displayDateToIso,
  formatMalaysianDate,
  formatMalaysianDateTime,
  isValidDisplayDate,
  isoToDisplayDate,
  malaysiaToday,
  malaysiaYear,
} from "@/lib/projecthub-date";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("Malaysian date standard", () => {
  it("formats ISO dates as DD/MM/YYYY", () => {
    expect(formatMalaysianDate("2026-01-09")).toBe("09/01/2026");
    expect(isoToDisplayDate("2026-12-31")).toBe("31/12/2026");
  });

  it("shows a stable fallback for missing dates", () => {
    expect(formatMalaysianDate(null)).toBe("—");
    expect(formatMalaysianDateTime(undefined)).toBe("—");
  });

  it("formats timestamps as DD/MM/YYYY HH:mm in Malaysia time", () => {
    // 2026-01-08T17:30:00Z is 01:30 on 9 January in Kuala Lumpur (UTC+8).
    expect(formatMalaysianDateTime("2026-01-08T17:30:00.000Z")).toBe("09/01/2026 01:30");
  });

  it("parses DD/MM/YYYY back to ISO and rejects impossible days", () => {
    expect(displayDateToIso("09/01/2026")).toBe("2026-01-09");
    expect(displayDateToIso("29/02/2024")).toBe("2024-02-29");
    expect(displayDateToIso("29/02/2026")).toBeNull();
    expect(displayDateToIso("13/13/2026")).toBeNull();
    expect(isValidDisplayDate("31/04/2026")).toBe(false);
  });

  it("derives today and the reference year from Malaysia local time", () => {
    // 31 December 2025 16:10 UTC is already 1 January 2026 in Malaysia.
    const instant = new Date("2025-12-31T16:10:00.000Z");
    expect(malaysiaToday(instant)).toBe("2026-01-01");
    expect(malaysiaYear(instant)).toBe(2026);
  });

  it("leaves no native date inputs in ProjectHub surfaces", () => {
    const files = walk(join(process.cwd(), "src")).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      if (file.endsWith(join("projecthub", "DateInput.tsx"))) continue;
      expect(readFileSync(file, "utf8"), `${file} must not use a native date input`).not.toContain(
        'type="date"',
      );
    }
  });
});
