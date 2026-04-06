/**
 * TracePanel — Right sidebar showing agent execution transparency.
 *
 * Displays the "glass-box" view of agent reasoning:
 * - Node execution timeline with status indicators
 * - Active MCP tool calls and their servers
 * - Intent reasoning chain-of-thought
 * - Timing information per node
 */
import { ChevronRight, Database, Brain, Sparkles, AlertCircle, Clock } from "lucide-react";
import type { TraceEvent, StreamStatus } from "../lib/types";

interface TracePanelProps {
  traceEvents: TraceEvent[];
  streamStatus: StreamStatus;
}

const NODE_CONFIG: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  intent_router: { label: "Intent Router", icon: Brain, color: "text-amber-400" },
  mcp_tool_caller: { label: "Data Retrieval", icon: Database, color: "text-cyan-400" },
  synthesis: { label: "Synthesis", icon: Sparkles, color: "text-indigo-400" },
  error_handler: { label: "Error Handler", icon: AlertCircle, color: "text-red-400" },
};

function StatusDot({ status }: { status: string }) {
  if (status === "running") {
    return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse-fast" />;
  }
  if (status === "complete") {
    return <span className="w-2.5 h-2.5 rounded-full bg-green-400" />;
  }
  return <span className="w-2.5 h-2.5 rounded-full bg-red-400" />;
}

export function TracePanel({ traceEvents, streamStatus }: TracePanelProps) {
  const isIdle = streamStatus === "idle" && traceEvents.length === 0;

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <ChevronRight size={14} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-200">Trace</h2>
        {streamStatus === "streaming" && (
          <span className="text-xs text-amber-400 ml-auto animate-pulse-fast">Live</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isIdle ? (
          <p className="text-xs text-gray-500 text-center mt-8">
            Agent trace will appear here when you submit a query.
          </p>
        ) : (
          <div className="space-y-3">
            {traceEvents.map((te, idx) => {
              const config = NODE_CONFIG[te.node] || {
                label: te.node,
                icon: Brain,
                color: "text-gray-400",
              };
              const Icon = config.icon;

              return (
                <div key={`${te.node}-${idx}`} className="animate-slide-in">
                  {/* Node header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusDot status={te.status} />
                    <Icon size={14} className={config.color} />
                    <span className="text-xs font-medium text-gray-300">{config.label}</span>
                    {te.status === "complete" && (
                      <span className="text-xs text-gray-600 ml-auto flex items-center gap-1">
                        <Clock size={10} />
                        done
                      </span>
                    )}
                  </div>

                  {/* Intent reasoning */}
                  {te.reasoning && (
                    <div className="ml-5 mb-1.5 px-2.5 py-1.5 bg-gray-900 rounded-lg border border-gray-800">
                      <p className="text-xs text-gray-400 leading-relaxed">{te.reasoning}</p>
                      {te.intent && (
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${
                          te.intent === "data_query"
                            ? "bg-cyan-900/50 text-cyan-400"
                            : te.intent === "follow_up"
                            ? "bg-indigo-900/50 text-indigo-400"
                            : "bg-amber-900/50 text-amber-400"
                        }`}>
                          {te.intent}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Tool activity */}
                  {te.tools && te.tools.length > 0 && (
                    <div className="ml-5 space-y-1">
                      {te.tools.map((tool, toolIdx) => (
                        <div
                          key={toolIdx}
                          className="flex items-center gap-2 px-2.5 py-1 bg-gray-900 rounded border border-gray-800"
                        >
                          <StatusDot status={tool.status} />
                          <span className="text-xs text-gray-400">{tool.server}</span>
                          <span className="text-xs text-gray-600">/</span>
                          <span className="text-xs text-gray-300 font-mono">{tool.tool}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
