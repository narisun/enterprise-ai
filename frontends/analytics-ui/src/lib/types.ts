/**
 * TypeScript types for the Analytics Platform API contract.
 *
 * These types mirror the Pydantic models in the analytics-agent backend
 * (schemas/ui_components.py and schemas/intent.py).
 */

// ── SSE Event Types ──────────────────────────────────────────────────────────

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface TextEvent {
  token: string;
}

export interface ToolCallStartEvent {
  node: string;
  run_id?: string;
}

export interface ToolCallEndEvent {
  node: string;
  intent?: string;
  reasoning?: string;
  plan_steps?: number;
  tools?: ToolActivity[];
}

export interface ToolActivity {
  tool: string;
  server: string;
  status: "running" | "complete" | "error";
  description?: string;
  started_at?: number;
  completed_at?: number;
  error?: string;
}

// ── UI Component Types ───────────────────────────────────────────────────────

export type ComponentType =
  | "BarChart"
  | "LineChart"
  | "AreaChart"
  | "PieChart"
  | "KPICard"
  | "DataTable";

export interface ChartMetadata {
  title: string;
  source: string;
  confidence_score: number;
  x_label?: string;
  y_label?: string;
  format_hint?: "currency" | "percent" | "number" | "compact";
}

export interface ChartDataPoint {
  category: string;
  value: number;
  series?: string;
}

export interface KPIDataPoint {
  label: string;
  value: number;
  change?: number;
  trend?: "up" | "down" | "flat";
}

export interface UIComponent {
  component_type: ComponentType;
  metadata: ChartMetadata;
  data: ChartDataPoint[] | KPIDataPoint[] | Record<string, unknown>[];
}

// ── Trace Panel Types ────────────────────────────────────────────────────────

export interface TraceEvent {
  node: string;
  status: "running" | "complete" | "error";
  timestamp: number;
  intent?: string;
  reasoning?: string;
  tools?: ToolActivity[];
}

// ── Chat Types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  components?: UIComponent[];
  traceEvents?: TraceEvent[];
  timestamp: number;
}

// ── Stream State ─────────────────────────────────────────────────────────────

export type StreamStatus = "idle" | "streaming" | "complete" | "error";

export interface StreamState {
  status: StreamStatus;
  narrative: string;
  components: UIComponent[];
  traceEvents: TraceEvent[];
  error: string | null;
}
