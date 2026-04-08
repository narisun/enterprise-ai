"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { ChartMetadata, ChartDataPoint } from "@/lib/types";
import { ChartCard } from "./ChartCard";
import {
  pivotByCategory, getSeriesNames, getSeriesColor, tooltipFormatter,
  TOOLTIP_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE, LEGEND_STYLE,
  GRID_COLOR, AXIS_TICK_COLOR,
} from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: ChartDataPoint[] | Record<string, unknown>[];
}

export default function AreaChartCard({ metadata, data }: Props) {
  const chartData = pivotByCategory(data as ChartDataPoint[]);
  const series = getSeriesNames(data as ChartDataPoint[]);

  const fullNameMap = new Map(chartData.map(d => [String(d.category), String(d.category)]));

  return (
    <ChartCard metadata={metadata}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: metadata.x_label ? 20 : 5 }}>
          <defs>
            {series.map((name, idx) => (
              <linearGradient key={name} id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getSeriesColor(idx)} stopOpacity={0.3} />
                <stop offset="95%" stopColor={getSeriesColor(idx)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey="category"
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            axisLine={{ stroke: GRID_COLOR }}
            tickLine={false}
            height={metadata.x_label ? 50 : 35}
            label={metadata.x_label ? { value: metadata.x_label, position: "insideBottom", fill: AXIS_TICK_COLOR, fontSize: 11, offset: -5 } : undefined}
          />
          <YAxis
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={tooltipFormatter(metadata.format_hint)}
            width={58}
            label={metadata.y_label ? {
              value: metadata.y_label,
              angle: -90,
              position: "insideLeft",
              dx: -50,
              fill: AXIS_TICK_COLOR,
              fontSize: 11,
              style: { textAnchor: "middle" },
            } : undefined}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={tooltipFormatter(metadata.format_hint)}
            labelFormatter={(label) => fullNameMap.get(String(label)) ?? String(label)}
          />
          {series.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} />}
          {series.map((name, idx) => (
            <Area key={name} type="monotone" dataKey={name} stroke={getSeriesColor(idx)} strokeWidth={2} fill={`url(#grad-${name})`} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
