"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { ChartMetadata, ChartDataPoint } from "@/lib/types";
import { ChartCard } from "./ChartCard";
import {
  pivotByCategory, getSeriesNames, getSeriesColor, tooltipFormatter,
  TOOLTIP_STYLE, GRID_COLOR, AXIS_TICK_COLOR,
} from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: ChartDataPoint[] | Record<string, unknown>[];
}

export default function AreaChartCard({ metadata, data }: Props) {
  const chartData = pivotByCategory(data as ChartDataPoint[]);
  const series = getSeriesNames(data as ChartDataPoint[]);

  return (
    <ChartCard metadata={metadata}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            {series.map((name, idx) => (
              <linearGradient key={name} id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getSeriesColor(idx)} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getSeriesColor(idx)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey="category" tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={tooltipFormatter(metadata.format_hint)} width={56} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(metadata.format_hint)} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TICK_COLOR }} />}
          {series.map((name, idx) => (
            <Area key={name} type="monotone" dataKey={name} stroke={getSeriesColor(idx)} strokeWidth={2} fill={`url(#grad-${name})`} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
