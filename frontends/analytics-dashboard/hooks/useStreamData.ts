"use client";

import { useMemo, useRef } from "react";
import type { UIComponent } from "@/lib/types";

/**
 * Extract UI components and follow-up suggestions from useChat's data stream.
 * Tracks turn boundaries: only parse items from current turn onwards, call commitTurn() when done.
 */
export function useStreamData(data: unknown[] | undefined) {
  // Offset into allComponents[] where the current turn starts
  const turnOffsetRef = useRef(0);
  // Offset into allItems[] where the current turn starts (tracks all parsed items,
  // not just components, so follow-up events can be sliced correctly)
  const turnItemOffsetRef = useRef(0);

  // Parse ALL data items (memoized on data reference)
  // Returns both a flat list of all UI components and a parallel flat list of
  // all items (components + follow-up events) so the turn-offset can slice both.
  const { allComponents, allItems } = useMemo(() => {
    if (!data || data.length === 0) {
      return { allComponents: [] as UIComponent[], allItems: [] as unknown[] };
    }

    const components: UIComponent[] = [];
    const items: unknown[] = [];

    for (const item of data) {
      if (Array.isArray(item)) {
        for (const entry of item) {
          items.push(entry);
          if (isUIComponent(entry)) {
            components.push(entry as unknown as UIComponent);
          }
        }
      } else {
        items.push(item);
        if (isUIComponent(item)) {
          components.push(item as unknown as UIComponent);
        }
      }
    }
    return { allComponents: components, allItems: items };
  }, [data]);

  // Components for this turn ONLY = everything from turnOffset onward.
  // The ref is read at render time (not inside useMemo) so it always reflects
  // the latest committed offset without creating stale-closure issues.
  const turnComponents = allComponents.slice(turnOffsetRef.current);

  // Follow-up suggestions for this turn ONLY — scan allItems from the item-level
  // turn offset, keep the last follow_up_suggestions event seen in that range.
  // Uses turnItemOffsetRef (not turnOffsetRef) because allItems includes both
  // components and follow-up events, so the component offset index is wrong here.
  const turnFollowUpSuggestions = useMemo(() => {
    const turnItems = allItems.slice(turnItemOffsetRef.current);
    let followUps: string[] = [];
    for (const entry of turnItems) {
      if (isFollowUpItem(entry)) {
        followUps = (entry as { type: string; suggestions: string[] }).suggestions;
      }
    }
    return followUps;
  // allItems identity changes when data changes — recomputes correctly on each update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems]);

  return {
    /** UI components that belong to the CURRENT turn only */
    turnComponents,
    /** Follow-up suggestions from the current turn only (not prior turns) */
    turnFollowUpSuggestions,
    /** Total count of all components parsed so far (across all turns) */
    totalCount: allComponents.length,
    /** Call after a turn finishes to advance both offsets for the next turn */
    commitTurn: () => {
      turnOffsetRef.current = allComponents.length;
      turnItemOffsetRef.current = allItems.length;
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

/** Validates that an object is a follow_up_suggestions data event from the agent. */
function isFollowUpItem(obj: unknown): boolean {
  if (obj == null || typeof obj !== "object") return false;
  const record = obj as Record<string, unknown>;
  return (
    record.type === "follow_up_suggestions" &&
    Array.isArray(record.suggestions)
  );
}
