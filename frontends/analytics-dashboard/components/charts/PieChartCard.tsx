"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ChartMetadata, ChartDataPoint } from "@/lib/types";
import { ChartCard } from "./ChartCard";
import { CHART_COLORS, tooltipFormatter, TOOLTIP_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE, LEGEND_STYLE } from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: ChartDataPoint[] | Record<string, unknown>[];
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent,
}: {
  cx: number; cy: number; midAngle: number;
  innerRadius: number; outerRadius: number; percent: number;
}) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="var(--color-text)" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={500}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function PieChartCard({ metadata, data }: Props) {
  const pieData = (data as ChartDataPoint[]).map((d) => ({ name: d.category, value: d.value }));

  return (
    <ChartCard metadata={metadata}>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85}
            dataKey="value" labelLine={false} label={renderCustomLabel}
            stroke="var(--color-background)" strokeWidth={2}
          >
            {pieData.map((_, idx) => (
              <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={tooltipFormatter(metadata.format_hint)}
          />
          <Legend wrapperStyle={LEGEND_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
