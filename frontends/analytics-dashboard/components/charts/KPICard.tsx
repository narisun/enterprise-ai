"use client";

import { TrendingUp, TrendingDown, Minus, Shield } from "lucide-react";
import type { ChartMetadata, KPIDataPoint } from "@/lib/types";
import { formatValue, confidenceLabel, confidenceColor } from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: KPIDataPoint[] | Record<string, unknown>[];
}

function TrendIcon({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp size={14} className="text-success" />;
  if (trend === "down") return <TrendingDown size={14} className="text-danger" />;
  return <Minus size={14} className="text-text-muted" />;
}

function trendColor(trend?: "up" | "down" | "flat"): string {
  if (trend === "up") return "text-success";
  if (trend === "down") return "text-danger";
  return "text-text-muted";
}

export default function KPICard({ metadata, data }: Props) {
  const kpis = data as KPIDataPoint[];

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-text truncate">{metadata.title}</h3>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <span className="text-[10px] text-text-muted bg-surface-2 rounded px-1.5 py-0.5">{metadata.source}</span>
          <span className={`flex items-center gap-0.5 text-[10px] ${confidenceColor(metadata.confidence_score)}`}>
            <Shield size={10} />
            {confidenceLabel(metadata.confidence_score)}
          </span>
        </div>
      </div>
      <div className={`grid gap-3 px-4 pb-4 ${
        kpis.length === 1 ? "grid-cols-1" :
        kpis.length === 2 ? "grid-cols-2" :
        kpis.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"
      }`}>
        {kpis.map((kpi, idx) => (
          <div key={idx} className="bg-surface-2/50 rounded-lg px-3 py-3 border border-border">
            <p className="text-[11px] text-text-muted mb-1 truncate">{kpi.label}</p>
            <p className="text-xl font-bold text-text">{formatValue(kpi.value, metadata.format_hint)}</p>
            {kpi.change != null && (
              <div className={`flex items-center gap-1 mt-1 ${trendColor(kpi.trend)}`}>
                <TrendIcon trend={kpi.trend} />
                <span className="text-xs font-medium">
                  {kpi.change > 0 ? "+" : ""}{kpi.change.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
