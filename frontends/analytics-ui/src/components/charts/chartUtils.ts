/**
 * Shared chart utilities — formatters, color palettes, and data helpers.
 */
import type { ChartMetadata, ChartDataPoint } from "../../lib/types";

// ── Color palette ──────────────────────────────────────────────────────────

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

// ── Value formatting ───────────────────────────────────────────────────────

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
    default:
      return value.toLocaleString();
  }
}

// ── Tooltip formatting ─────────────────────────────────────────────────────

export function tooltipFormatter(hint?: ChartMetadata["format_hint"]) {
  return (value: number) => formatValue(value, hint);
}

// ── Series extraction ──────────────────────────────────────────────────────

/**
 * Pivot ChartDataPoint[] with series into Recharts-friendly format:
 * [{ category, seriesA: 10, seriesB: 20 }, ...]
 */
export function pivotByCategory(
  data: ChartDataPoint[]
): { category: string; [series: string]: string | number }[] {
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

/**
 * Get unique series names from the data.
 */
export function getSeriesNames(data: ChartDataPoint[]): string[] {
  const names = new Set<string>();
  for (const point of data) {
    names.add(point.series || "value");
  }
  return Array.from(names);
}

// ── Confidence badge ───────────────────────────────────────────────────────

export function confidenceLabel(score: number): string {
  if (score >= 0.9) return "High";
  if (score >= 0.7) return "Medium";
  return "Low";
}

export function confidenceColor(score: number): string {
  if (score >= 0.9) return "text-green-400";
  if (score >= 0.7) return "text-amber-400";
  return "text-red-400";
}
