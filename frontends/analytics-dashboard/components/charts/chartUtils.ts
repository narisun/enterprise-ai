/**
 * Shared chart utilities — formatters, color palettes, and data helpers.
 */
import type { ChartMetadata, ChartDataPoint } from "@/lib/types";

// Color palette

export const CHART_COLORS = [
  "#818cf8", // indigo-400
  "#22d3ee", // cyan-400
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#f87171", // red-400
  "#fb923c", // orange-400
  "#e879f9", // fuchsia-400
];

export function getSeriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// Date detection and formatting

/**
 * Check if a numeric value looks like a YYYYMMDD date integer.
 * e.g., 20250803 → true, 1500000 → false
 */
function looksLikeDateInt(value: number): boolean {
  if (!Number.isInteger(value)) return false;
  if (value < 19000101 || value > 20991231) return false;
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Check if a string looks like a date (ISO format, slash-separated, etc.)
 */
function looksLikeDateStr(value: string): boolean {
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value);
}

/**
 * Check if a column name suggests it contains dates.
 */
export function isDateColumnName(name: string): boolean {
  const lower = name.toLowerCase();
  return /date|_dt$|_at$|timestamp|created|updated|onboarding|established|start_date/.test(lower);
}

/**
 * Infer the right format hint for one DataTable column from its name.
 *
 * `format_hint` on ChartMetadata is component-level — but a single table
 * routinely mixes currency, counts, and percentages across columns. Trust
 * the column name first; fall back to the metadata hint only when no
 * pattern matches. The fallback prevents a metadata `format_hint: "currency"`
 * from stamping a `$` on every count column.
 */
export function inferColumnFormat(
  colName: string,
  fallback?: ChartMetadata["format_hint"],
): ChartMetadata["format_hint"] | undefined {
  const lower = colName.toLowerCase();

  // Counts / quantities → plain number, never currency.
  if (
    /^(tx_)?count$|_count$|^cnt$|_cnt$|^qty$|^num(_|$)|_num$|^n_/.test(lower) ||
    lower.endsWith("_count") ||
    lower.endsWith("_cnt") ||
    lower === "count" ||
    lower === "transactions" ||
    lower === "txn_count" ||
    lower === "rows"
  ) {
    return "number";
  }

  // Percent / rate → percent.
  if (/^pct$|_pct$|^percent$|_percent$|^rate$|_rate$|^ratio$|_ratio$|trend_pct/.test(lower)) {
    return "percent";
  }

  // Money columns → currency.
  if (
    /amount|total|revenue|volume|balance|usd|price|cost|spend|premium|gross|net/.test(lower) ||
    lower.endsWith("_usd")
  ) {
    return "currency";
  }

  return fallback;
}

/**
 * Format a date value (integer YYYYMMDD, ISO string, or Date-parseable string)
 * into a human-readable format.
 */
export function formatDateValue(value: number | string): string {
  let d: Date;
  if (typeof value === "number" && looksLikeDateInt(value)) {
    const y = Math.floor(value / 10000);
    const m = Math.floor((value % 10000) / 100) - 1;
    const day = value % 100;
    d = new Date(y, m, day);
  } else if (typeof value === "string" && looksLikeDateStr(value)) {
    // Parse "2025-08-03" or "2025-08-03T12:00:00Z"
    d = new Date(value.replace(/-/g, "/").split("T")[0]);
  } else {
    // Try native parsing as last resort
    d = new Date(value);
  }
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Format a datetime value into a human-readable format with time.
 */
export function formatDateTimeValue(value: number | string): string {
  const dateStr = formatDateValue(value);
  if (typeof value === "string" && value.includes("T")) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return `${dateStr} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  return dateStr;
}

// Value formatting

export function formatValue(
  value: number,
  hint?: ChartMetadata["format_hint"]
): string {
  switch (hint) {
    case "currency":
      return value >= 1_000_000
        ? `$${(value / 1_000_000).toFixed(1)}M`
        : value >= 1_000
        ? `$${(value / 1_000).toFixed(1)}K`
        : `$${value.toLocaleString()}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "compact":
      return value >= 1_000_000
        ? `${(value / 1_000_000).toFixed(1)}M`
        : value >= 1_000
        ? `${(value / 1_000).toFixed(1)}K`
        : value.toLocaleString();
    case "date":
      return formatDateValue(value);
    case "datetime":
      return formatDateTimeValue(value);
    default:
      // Auto-detect date integers to prevent "20,250,803" formatting
      if (looksLikeDateInt(value)) {
        return formatDateValue(value);
      }
      return value.toLocaleString();
  }
}

// Tooltip formatting

export function tooltipFormatter(hint?: ChartMetadata["format_hint"]) {
  return (value: number) => formatValue(value, hint);
}

// Series extraction

export function pivotByCategory(
  data: ChartDataPoint[]
): Record<string, string | number>[] {
  const grouped = new Map<string, Record<string, string | number>>();

  for (const point of data) {
    const key = point.category;
    if (!grouped.has(key)) {
      grouped.set(key, { category: key });
    }
    const row = grouped.get(key)!;
    const seriesName = point.series || "value";
    row[seriesName] = point.value;
  }

  return Array.from(grouped.values());
}

export function getSeriesNames(data: ChartDataPoint[]): string[] {
  const names = new Set<string>();
  for (const point of data) {
    names.add(point.series || "value");
  }
  return Array.from(names);
}

// Axis label truncation

/** Max characters to display on a chart axis tick before shortening. */
export const AXIS_LABEL_MAX_LEN = 16;

/**
 * Strip common institutional / geographic suffixes that add length without
 * adding meaning in a chart context.
 * e.g. "TD Bank, N.A. (US)" → "TD Bank"
 *      "BMO Harris Bank (US)" → "BMO Harris Bank"
 */
function simplifyCategory(text: string): string {
  return text
    .replace(/\s*\([A-Z]{2,3}\)\s*$/, "")   // "(US)", "(CA)", "(UK)" …
    .replace(/,?\s*N\.A\.\s*$/i, "")          // "N.A." / ", N.A."
    .replace(/,?\s*Inc\.?\s*$/i, "")          // "Inc" / "Inc."
    .replace(/,?\s*LLC\.?\s*$/i, "")          // "LLC"
    .replace(/,?\s*Corp\.?\s*$/i, "")         // "Corp" / "Corp."
    .replace(/,?\s*Ltd\.?\s*$/i, "")          // "Ltd" / "Ltd."
    .trim();
}

/**
 * Return a shortened axis label for display.
 * First simplifies common suffixes, then truncates at a word boundary
 * if the result is still over maxLen characters.
 * Returns the simplified string unchanged when it already fits.
 */
export function truncateLabel(text: string, maxLen = AXIS_LABEL_MAX_LEN): string {
  const simplified = simplifyCategory(text);
  if (simplified.length <= maxLen) return simplified;
  // Cut at the last word boundary before (maxLen - 1) and add an ellipsis
  const cutAt = maxLen - 1;
  const lastSpace = simplified.lastIndexOf(" ", cutAt);
  const stem = lastSpace > 0 ? simplified.slice(0, lastSpace) : simplified.slice(0, cutAt);
  return stem + "…";
}

/**
 * Build a map of { displayLabel → originalFullLabel } for every category
 * whose display label differs from the original (i.e. was shortened).
 * Used to render a name legend and to show full names in tooltips.
 */
export function buildShortNameMap(
  categories: string[],
  maxLen = AXIS_LABEL_MAX_LEN,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of categories) {
    const short = truncateLabel(cat, maxLen);
    if (short !== cat) map.set(short, cat);
  }
  return map;
}

// Theme-aware styles

/**
 * Recharts Tooltip uses CSS custom properties so theme changes are reactive.
 */
/**
 * Recharts tooltip style.
 *
 * Uses explicit hex colors instead of CSS custom properties because Recharts
 * renders tooltip HTML outside the normal component tree, so var() references
 * are unreliable.  The values below match the .dark theme in globals.css with
 * a deliberately lighter background for contrast against chart surfaces.
 */
export const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "#2a2a3d",
  border: "1px solid #3e3e52",
  borderRadius: "8px",
  fontSize: 12,
  color: "#e8e8f0",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
  padding: "8px 12px",
};

/** Recharts tooltip item/label styles (explicit colors for portalled HTML) */
export const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  color: "#e8e8f0",
  fontSize: 12,
};
export const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "#c0c0d0",
  fontSize: 11,
  marginBottom: 2,
};

/** Legend wrapper style (explicit hex — Recharts renders outside CSS variable scope) */
export const LEGEND_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: "#8a8aa0",
};

/** Grid / axis line color (string for Recharts stroke prop) */
export const GRID_COLOR = "var(--color-border)";
/** Axis tick label fill */
export const AXIS_TICK_COLOR = "var(--color-text-muted)";

// Confidence scoring

export function confidenceLabel(score: number): string {
  if (score >= 0.9) return "High";
  if (score >= 0.7) return "Medium";
  return "Low";
}

export function confidenceColor(score: number): string {
  if (score >= 0.9) return "text-success";
  if (score >= 0.7) return "text-warning";
  return "text-danger";
}
