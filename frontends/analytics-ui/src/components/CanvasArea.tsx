/**
 * CanvasArea — Central canvas displaying charts and data components.
 *
 * Renders UIComponent[] in a responsive grid layout. During streaming,
 * shows a skeleton placeholder for upcoming components.
 */
import { LayoutGrid } from "lucide-react";
import { ChartRenderer } from "./charts";
import type { UIComponent, StreamStatus } from "../lib/types";

interface CanvasAreaProps {
  components: UIComponent[];
  streamStatus: StreamStatus;
}

function EmptyCanvas() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <LayoutGrid size={40} className="text-gray-700 mb-4" />
      <p className="text-sm text-gray-500 mb-1">Visualizations appear here</p>
      <p className="text-xs text-gray-600">
        Charts, KPI cards, and data tables will render as the agent responds.
      </p>
    </div>
  );
}

function StreamingSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse-fast">
      <div className="h-3 w-2/5 bg-gray-800 rounded mb-3" />
      <div className="h-44 bg-gray-800 rounded mb-2" />
      <div className="h-2 w-1/4 bg-gray-800 rounded" />
    </div>
  );
}

export function CanvasArea({ components, streamStatus }: CanvasAreaProps) {
  const isEmpty = components.length === 0;
  const isStreaming = streamStatus === "streaming";

  if (isEmpty && !isStreaming) {
    return (
      <div className="flex-1 h-full bg-gray-950">
        <EmptyCanvas />
      </div>
    );
  }

  return (
    <div className="flex-1 h-full bg-gray-950 overflow-y-auto">
      <div className="p-4">
        <div className={`grid gap-4 ${
          components.length === 1
            ? "grid-cols-1"
            : "grid-cols-1 lg:grid-cols-2"
        }`}>
          {components.map((comp, idx) => (
            <ChartRenderer key={`${comp.component_type}-${idx}`} component={comp} />
          ))}
          {isStreaming && <StreamingSkeleton />}
        </div>
      </div>
    </div>
  );
}
