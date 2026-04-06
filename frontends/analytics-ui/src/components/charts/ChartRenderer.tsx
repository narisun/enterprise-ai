/**
 * ChartRenderer — Component interceptor for dynamic chart rendering.
 *
 * Dispatches on UIComponent.component_type to the appropriate Recharts
 * wrapper or card component. Uses React.lazy for code-splitting so
 * chart bundles are only loaded when first needed.
 */
import { Suspense, lazy } from "react";
import type { UIComponent } from "../../lib/types";

const BarChartCard = lazy(() => import("./BarChartCard"));
const LineChartCard = lazy(() => import("./LineChartCard"));
const AreaChartCard = lazy(() => import("./AreaChartCard"));
const PieChartCard = lazy(() => import("./PieChartCard"));
const KPICard = lazy(() => import("./KPICard"));
const DataTable = lazy(() => import("./DataTable"));

function ChartSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse-fast">
      <div className="h-4 w-1/3 bg-gray-800 rounded mb-4" />
      <div className="h-48 bg-gray-800 rounded" />
    </div>
  );
}

interface ChartRendererProps {
  component: UIComponent;
}

export function ChartRenderer({ component }: ChartRendererProps) {
  const { component_type, metadata, data } = component;

  return (
    <Suspense fallback={<ChartSkeleton />}>
      {component_type === "BarChart" && (
        <BarChartCard metadata={metadata} data={data} />
      )}
      {component_type === "LineChart" && (
        <LineChartCard metadata={metadata} data={data} />
      )}
      {component_type === "AreaChart" && (
        <AreaChartCard metadata={metadata} data={data} />
      )}
      {component_type === "PieChart" && (
        <PieChartCard metadata={metadata} data={data} />
      )}
      {component_type === "KPICard" && (
        <KPICard metadata={metadata} data={data} />
      )}
      {component_type === "DataTable" && (
        <DataTable metadata={metadata} data={data} />
      )}
    </Suspense>
  );
}
