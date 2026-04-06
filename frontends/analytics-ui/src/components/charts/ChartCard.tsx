/**
 * ChartCard — Shared wrapper card for all chart types.
 *
 * Provides consistent title, source badge, and confidence indicator.
 */
import { Shield } from "lucide-react";
import type { ChartMetadata } from "../../lib/types";
import { confidenceLabel, confidenceColor } from "./chartUtils";

interface ChartCardProps {
  metadata: ChartMetadata;
  children: React.ReactNode;
}

export function ChartCard({ metadata, children }: ChartCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h3 className="text-sm font-semibold text-gray-200 truncate">
          {metadata.title}
        </h3>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <span className="text-[10px] text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
            {metadata.source}
          </span>
          <span
            className={`flex items-center gap-0.5 text-[10px] ${confidenceColor(
              metadata.confidence_score
            )}`}
            title={`Confidence: ${(metadata.confidence_score * 100).toFixed(0)}%`}
          >
            <Shield size={10} />
            {confidenceLabel(metadata.confidence_score)}
          </span>
        </div>
      </div>

      {/* Chart body */}
      <div className="px-2 pb-3">{children}</div>
    </div>
  );
}
