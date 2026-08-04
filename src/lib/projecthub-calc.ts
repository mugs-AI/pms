/**
 * Deterministic BOQ planning arithmetic.
 *
 * Binary floating point is never the accounting truth here: every value is
 * converted to a scaled BigInt, multiplied exactly, and rounded half-up once.
 * The same module runs on the server (authoritative) and in the browser
 * (immediate display), so the two can never disagree.
 *
 * These are ProjectHub PLANNING values. They are not N3 postings and they are
 * not a verified N3 Sales Quotation tax computation.
 */

/** Quantities and rates are stored with 4 decimal places. */
export const RATE_DP = 4;
/** Money results are presented with 2 decimal places. */
export const MONEY_DP = 2;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Parses a decimal string/number into a BigInt scaled by 10^dp (half-up). */
export function toScaled(value: number | string | null | undefined, dp: number): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  const text = typeof value === "number" ? value.toFixed(dp + 2) : String(value).trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return 0n;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] || "0";
  const frac = match[3] ?? "";
  const kept = frac.slice(0, dp).padEnd(dp, "0");
  const nextDigit = frac.charCodeAt(dp) - 48;
  let scaled = BigInt(whole + kept);
  if (nextDigit >= 5 && nextDigit <= 9) scaled += 1n;
  return sign * scaled;
}

/** Renders a scaled BigInt as a fixed-decimal string. */
export function fromScaled(scaled: bigint, dp: number): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const factor = pow10(dp);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(dp, "0");
  const body = dp > 0 ? `${whole}.${frac}` : whole.toString();
  return negative && abs !== 0n ? `-${body}` : body;
}

/** Divides `value` by 10^shift, rounding half-up away from zero. */
function rescale(value: bigint, shift: number): bigint {
  if (shift <= 0) return value * pow10(-shift);
  const factor = pow10(shift);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const quotient = abs / factor;
  const remainder = abs % factor;
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Rounds `numer / denom` half-up. Returns null when the denominator is zero. */
function divideHalfUp(numer: bigint, denom: bigint): bigint | null {
  if (denom === 0n) return null;
  const negative = numer < 0n !== denom < 0n;
  const a = numer < 0n ? -numer : numer;
  const b = denom < 0n ? -denom : denom;
  const quotient = a / b;
  const rounded = (a % b) * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * `numer / denom` as a percentage with MONEY_DP decimals. Both inputs must
 * share the same scale; the scale cancels out in the ratio.
 */
function percentOf(numer: bigint, denom: bigint): string | null {
  const scaled = divideHalfUp(numer * 100n * pow10(MONEY_DP), denom);
  return scaled === null ? null : fromScaled(scaled, MONEY_DP);
}

export type BoqLineInput = {
  itemType: string;
  quantity: number | string;
  costRate: number | string;
  sellingRate: number | string;
  /** Percentage, e.g. 6 for 6%. Null means no tax snapshot selected. */
  taxRate?: number | string | null;
  sectionId?: string | null;
  projectPhaseId?: string | null;
};

export type BoqLineTotals = {
  costAmount: string;
  sellingAmount: string;
  taxAmount: string;
  sellingAmountWithTax: string;
  grossProfit: string;
  /** Null when the selling amount is zero. */
  grossMarginPercent: string | null;
  /** Null when the cost amount is zero. */
  markupPercent: string | null;
};

const MONEY_SHIFT = RATE_DP * 2 - MONEY_DP; // qty(4dp) * rate(4dp) -> 8dp -> 2dp

/** Per-line planning amounts, rounded once to 2 decimal places. */
export function calculateLine(line: BoqLineInput): BoqLineTotals {
  const qty = toScaled(line.quantity, RATE_DP);
  const cost = rescale(qty * toScaled(line.costRate, RATE_DP), MONEY_SHIFT);
  const selling = rescale(qty * toScaled(line.sellingRate, RATE_DP), MONEY_SHIFT);

  // tax rate is a percentage with 4dp -> divide by 100 as well.
  const taxRate = toScaled(line.taxRate ?? 0, RATE_DP);
  const tax = rescale(selling * taxRate, RATE_DP + 2);

  const profit = selling - cost;
  return {
    costAmount: fromScaled(cost, MONEY_DP),
    sellingAmount: fromScaled(selling, MONEY_DP),
    taxAmount: fromScaled(tax, MONEY_DP),
    sellingAmountWithTax: fromScaled(selling + tax, MONEY_DP),
    grossProfit: fromScaled(profit, MONEY_DP),
    grossMarginPercent: percentOf(profit, selling),
    markupPercent: percentOf(profit, cost),
  };
}

export type BoqTotals = {
  totalCost: string;
  totalSelling: string;
  totalTax: string;
  totalSellingWithTax: string;
  grossProfit: string;
  grossMarginPercent: string | null;
  lineCount: number;
};

function emptyAccumulator() {
  return { cost: 0n, selling: 0n, tax: 0n, count: 0 };
}

function finalise(acc: ReturnType<typeof emptyAccumulator>): BoqTotals {
  const profit = acc.selling - acc.cost;
  return {
    totalCost: fromScaled(acc.cost, MONEY_DP),
    totalSelling: fromScaled(acc.selling, MONEY_DP),
    totalTax: fromScaled(acc.tax, MONEY_DP),
    totalSellingWithTax: fromScaled(acc.selling + acc.tax, MONEY_DP),
    grossProfit: fromScaled(profit, MONEY_DP),
    grossMarginPercent: percentOf(profit, acc.selling),
    lineCount: acc.count,
  };
}

function addLine(acc: ReturnType<typeof emptyAccumulator>, totals: BoqLineTotals) {
  acc.cost += toScaled(totals.costAmount, MONEY_DP);
  acc.selling += toScaled(totals.sellingAmount, MONEY_DP);
  acc.tax += toScaled(totals.taxAmount, MONEY_DP);
  acc.count += 1;
}

export type BoqSummary = {
  totals: BoqTotals;
  bySection: Record<string, BoqTotals>;
  byPhase: Record<string, BoqTotals>;
  byItemType: Record<string, BoqTotals>;
  lines: BoqLineTotals[];
};

/** Version totals plus section, phase and item-type subtotals. */
export function summariseBoq(lines: BoqLineInput[]): BoqSummary {
  const overall = emptyAccumulator();
  const sections = new Map<string, ReturnType<typeof emptyAccumulator>>();
  const phases = new Map<string, ReturnType<typeof emptyAccumulator>>();
  const types = new Map<string, ReturnType<typeof emptyAccumulator>>();
  const lineTotals: BoqLineTotals[] = [];

  const bucket = (map: Map<string, ReturnType<typeof emptyAccumulator>>, key: string) => {
    const found = map.get(key) ?? emptyAccumulator();
    map.set(key, found);
    return found;
  };

  for (const line of lines) {
    const totals = calculateLine(line);
    lineTotals.push(totals);
    addLine(overall, totals);
    addLine(bucket(sections, line.sectionId ?? "unsectioned"), totals);
    addLine(bucket(phases, line.projectPhaseId ?? "unphased"), totals);
    addLine(bucket(types, line.itemType), totals);
  }

  const materialise = (map: Map<string, ReturnType<typeof emptyAccumulator>>) =>
    Object.fromEntries([...map.entries()].map(([k, v]) => [k, finalise(v)]));

  return {
    totals: finalise(overall),
    bySection: materialise(sections),
    byPhase: materialise(phases),
    byItemType: materialise(types),
    lines: lineTotals,
  };
}

/** Simple-budget mode totals: one cost figure and one selling figure. */
export function simpleBudgetTotals(cost: number | string | null, selling: number | string | null) {
  const c = toScaled(cost ?? 0, MONEY_DP);
  const s = toScaled(selling ?? 0, MONEY_DP);
  const profit = s - c;
  return {
    totalCost: fromScaled(c, MONEY_DP),
    totalSelling: fromScaled(s, MONEY_DP),
    grossProfit: fromScaled(profit, MONEY_DP),
    grossMarginPercent: percentOf(profit, s),
  };
}

/** Malaysian-ringgit style presentation for ProjectHub planning values. */
export function formatMoney(value: string | number | null | undefined, currency = "MYR"): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)}%`;
}
