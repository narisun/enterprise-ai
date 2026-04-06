"use client";

import { useMemo, useRef } from "react";
import type { UIComponent } from "@/lib/types";

/**
 * Extract UI components from useChat's data stream.
 * Tracks turn boundaries: only parse items from current turn onwards, call commitTurn() when done.
 */
export function useStreamData(data: unknown[] | undefined) {
  // Offset into the data array where the current turn starts
  const turnOffsetRef = useRef(0);

  // Parse ALL data items (memoized on data reference)
  const allComponents = useMemo(() => {
    if (!data || data.length === 0) return [] as UIComponent[];

    const components: UIComponent[] = [];
    for (const item of data) {
      if (Array.isArray(item)) {
        for (const comp of item) {
          if (isUIComponent(comp)) {
            components.push(comp as unknown as UIComponent);
          }
        }
      } else if (isUIComponent(item)) {
        components.push(item as unknown as UIComponent);
      }
    }
    return components;
  }, [data]);

  // Components for this turn ONLY = everything from turnOffset onward
  // We derive this from allComponents + the ref. Since the ref is read
  // at render time (not inside useMemo), it always reflects the latest offset.
  const turnComponents = allComponents.slice(turnOffsetRef.current);

  return {
    /** UI components that belong to the CURRENT turn only */
    turnComponents,
    /** Total count of all components parsed so far (across all turns) */
    totalCount: allComponents.length,
    /** Call after a turn finishes to advance the offset for the next turn */
    commitTurn: () => {
      turnOffsetRef.current = allComponents.length;
    },
  };
}

const VALID_COMPONENT_TYPES = new Set([
  "BarChart", "LineChart", "AreaChart", "PieChart", "KPICard", "DataTable",
]);

/** Validates that an object matches the UIComponent shape from the agent. */
function isUIComponent(obj: unknown): boolean {
  if (obj == null || typeof obj !== "object") return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record.component_type === "string" &&
    VALID_COMPONENT_TYPES.has(record.component_type) &&
    record.metadata != null &&
    Array.isArray(record.data)
  );
}
