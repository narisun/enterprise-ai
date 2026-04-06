/**
 * PieChartCard — Recharts PieChart wrapper with custom labels.
 */
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ChartMetadata, ChartDataPoint } from "../../lib/types";
import { ChartCard } from "./ChartCard";
import { CHART_COLORS, tooltipFormatter, formatValue } from "./chartUtils";

interface Props {
  metadata: ChartMetadata;
  data: ChartDataPoint[] | Record<string, unknown>[];
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) {
  if (percent < 0.05) return null; // Skip tiny slices
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#e5e7eb"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={500}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function PieChartCard({ metadata, data }: Props) {
  const pieData = (data as ChartDataPoint[]).map((d) => ({
    name: d.category,
    value: d.value,
  }));

  return (
    <ChartCard metadata={metadata}>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={85}
            dataKey="value"
            labelLine={false}
            label={renderCustomLabel}
            stroke="#030712"
            strokeWidth={2}
          >
            {pieData.map((_, idx) => (
              <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: 12,
            }}
            formatter={tooltipFormatter(metadata.format_hint)}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#9ca3af" }}
            formatter={(value: string) => (
              <span className="text-gray-400">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
