"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
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

export default function BarChartCard({ metadata, data }: Props) {
  const chartData = pivotByCategory(data as ChartDataPoint[]);
  const series = getSeriesNames(data as ChartDataPoint[]);

  return (
    <ChartCard metadata={metadata}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey="category"
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            axisLine={{ stroke: GRID_COLOR }}
            tickLine={false}
            label={metadata.x_label ? { value: metadata.x_label, position: "bottom", fill: AXIS_TICK_COLOR, fontSize: 10, offset: -2 } : undefined}
          />
          <YAxis
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={tooltipFormatter(metadata.format_hint)}
            width={56}
            label={metadata.y_label ? { value: metadata.y_label, angle: -90, position: "insideLeft", fill: AXIS_TICK_COLOR, fontSize: 10 } : undefined}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={tooltipFormatter(metadata.format_hint)}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TICK_COLOR }} />}
          {series.map((name, idx) => (
            <Bar key={name} dataKey={name} fill={getSeriesColor(idx)} radius={[4, 4, 0, 0]} maxBarSize={40} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
