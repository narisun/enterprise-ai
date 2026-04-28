/**
 * TypeScript types for the Analytics Dashboard.
 *
 * Mirrors the Pydantic models in analytics-agent/src/schemas/ui_components.py.
 */

// UI Component Types

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
  format_hint?: "currency" | "percent" | "number" | "compact" | "date" | "datetime";
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

// Conversation History Types

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  components?: UIComponent[];
  createdAt: number;
}
