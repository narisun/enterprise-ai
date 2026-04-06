/**
 * DataTable — Tabular data display with sortable columns.
 */
import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ChartMetadata } from "../../lib/types";
import { ChartCard } from "./ChartCard";
import { formatValue } from "./chartUtils";

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
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [data, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortCol(null);
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  if (data.length === 0) {
    return (
      <ChartCard metadata={metadata}>
        <p className="text-xs text-gray-500 text-center py-8">No data available</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard metadata={metadata}>
      <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="text-left text-gray-500 font-medium px-3 py-2 cursor-pointer
                    hover:text-gray-300 transition-colors select-none whitespace-nowrap"
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
              <tr
                key={rowIdx}
                className="border-t border-gray-800 hover:bg-gray-800/50 transition-colors"
              >
                {columns.map((col) => {
                  const val = row[col];
                  const isNum = typeof val === "number";
                  return (
                    <td
                      key={col}
                      className={`px-3 py-1.5 whitespace-nowrap ${
                        isNum ? "text-gray-200 font-mono" : "text-gray-400"
                      }`}
                    >
                      {isNum
                        ? formatValue(val, metadata.format_hint)
                        : String(val ?? "")}
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
