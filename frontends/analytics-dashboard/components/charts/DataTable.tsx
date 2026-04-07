"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ChartMetadata } from "@/lib/types";
import { ChartCard } from "./ChartCard";
import { formatValue, formatDateValue, isDateColumnName } from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: Record<string, unknown>[];
}

type SortDir = "asc" | "desc" | null;

export default function DataTable({ metadata, data }: Props) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }, [data]);

  const sortedData = useMemo(() => {
    if (!sortCol || !sortDir) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
        : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
  }, [data, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      // Third click: clear sort entirely
      setSortCol(null);
      setSortDir(null);
    }
  };

  if (data.length === 0) {
    return (
      <ChartCard metadata={metadata}>
        <p className="text-xs text-text-muted text-center py-8">No data available</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard metadata={metadata}>
      <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="text-left text-text-muted font-medium px-3 py-2 cursor-pointer hover:text-text transition-colors select-none whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {sortCol === col && sortDir === "asc" && <ChevronUp size={12} />}
                    {sortCol === col && sortDir === "desc" && <ChevronDown size={12} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-t border-border hover:bg-surface-2/50 transition-colors">
                {columns.map((col) => {
                  const val = row[col];
                  const isNum = typeof val === "number";
                  const isDateCol = isDateColumnName(col);

                  // Format the cell value
                  let display: string;
                  if (isDateCol && val != null) {
                    // Date columns: format regardless of type (int 20250803 or string "2025-08-03")
                    display = formatDateValue(val as number | string);
                  } else if (isNum) {
                    display = formatValue(val, metadata.format_hint);
                  } else {
                    display = String(val ?? "");
                  }

                  return (
                    <td key={col} className={`px-3 py-1.5 whitespace-nowrap ${isNum && !isDateCol ? "text-text font-mono" : "text-text-muted"}`}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
