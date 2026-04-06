"use client";

import { Suspense, lazy, useEffect, useRef } from "react";
import type { UIComponent } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { traceComponentRender } from "@/lib/telemetry";

const BarChartCard = lazy(() => import("./BarChartCard"));
const LineChartCard = lazy(() => import("./LineChartCard"));
const AreaChartCard = lazy(() => import("./AreaChartCard"));
const PieChartCard = lazy(() => import("./PieChartCard"));
const KPICard = lazy(() => import("./KPICard"));
const DataTable = lazy(() => import("./DataTable"));

function ChartSkeleton() {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <Skeleton className="h-4 w-1/3 mb-4" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

interface ChartRendererProps {
  component: UIComponent;
}

/**
 * Dispatches a UIComponent to its corresponding Recharts wrapper.
 * Data shape is determined by component_type at the backend (Pydantic validates it),
 * so the cast at each branch is intentional and type-safe at runtime.
 */
export function ChartRenderer({ component }: ChartRendererProps) {
  const { component_type, metadata, data } = component;
  const traceRef = useRef<ReturnType<typeof traceComponentRender> | null>(null);

  // Trace component render timing on mount
  useEffect(() => {
    const dataPointCount = Array.isArray(data) ? data.length : 0;
    const trace = traceComponentRender(component_type, dataPointCount);
    traceRef.current = trace;

    // End trace after render (next frame to allow for paint)
    const timer = requestAnimationFrame(() => {
      trace.end();
    });

    return () => {
      cancelAnimationFrame(timer);
    };
  }, [component_type, data.length]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function renderChart() {
    switch (component_type) {
      case "BarChart":   return <BarChartCard metadata={metadata} data={data as any} />;
      case "LineChart":  return <LineChartCard metadata={metadata} data={data as any} />;
      case "AreaChart":  return <AreaChartCard metadata={metadata} data={data as any} />;
      case "PieChart":   return <PieChartCard metadata={metadata} data={data as any} />;
      case "KPICard":    return <KPICard metadata={metadata} data={data as any} />;
      case "DataTable":  return <DataTable metadata={metadata} data={data as any} />;
      default:           return null;
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return <Suspense fallback={<ChartSkeleton />}>{renderChart()}</Suspense>;
}
