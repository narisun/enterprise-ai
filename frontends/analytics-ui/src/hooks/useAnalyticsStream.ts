/**
 * useAnalyticsStream — React hook for consuming the analytics SSE stream.
 *
 * Uses useReducer for predictable state transitions (same pattern as
 * the existing agent-ui useAgentStream hook). The reducer is a pure
 * function that can be unit-tested independently.
 *
 * State tracks:
 *   - narrative: streaming text tokens from the agent
 *   - components: UI component schemas for the canvas area
 *   - traceEvents: node execution events for the glass-box trace panel
 *   - status: idle | streaming | complete | error
 */
import { useReducer, useCallback } from "react";
import { sseStream } from "../lib/sse";
import type {
  StreamState,
  UIComponent,
  TraceEvent,
  ToolCallEndEvent,
} from "../lib/types";

// ── Actions ──────────────────────────────────────────────────────────────────

type StreamAction =
  | { type: "START" }
  | { type: "TEXT"; token: string }
  | { type: "TOOL_CALL_START"; node: string }
  | { type: "TOOL_CALL_END"; payload: ToolCallEndEvent }
  | { type: "UI_COMPONENT"; component: UIComponent }
  | { type: "END" }
  | { type: "ERROR"; error: string };

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState: StreamState = {
  status: "idle",
  narrative: "",
  components: [],
  traceEvents: [],
  error: null,
};

export function analyticsStreamReducer(
  state: StreamState,
  action: StreamAction
): StreamState {
  switch (action.type) {
    case "START":
      return {
        ...initialState,
        status: "streaming",
      };

    case "TEXT":
      return {
        ...state,
        narrative: state.narrative + action.token,
      };

    case "TOOL_CALL_START": {
      const traceEvent: TraceEvent = {
        node: action.node,
        status: "running",
        timestamp: Date.now(),
      };
      return {
        ...state,
        traceEvents: [...state.traceEvents, traceEvent],
      };
    }

    case "TOOL_CALL_END": {
      const { node, intent, reasoning, tools } = action.payload;
      return {
        ...state,
        traceEvents: state.traceEvents.map((te) =>
          te.node === node && te.status === "running"
            ? { ...te, status: "complete" as const, intent, reasoning, tools }
            : te
        ),
      };
    }

    case "UI_COMPONENT":
      return {
        ...state,
        components: [...state.components, action.component],
      };

    case "END":
      return {
        ...state,
        status: "complete",
      };

    case "ERROR":
      return {
        ...state,
        status: "error",
        error: action.error,
      };

    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalyticsStream() {
  const [state, dispatch] = useReducer(analyticsStreamReducer, initialState);

  const send = useCallback(
    async (sessionId: string, message: string) => {
      dispatch({ type: "START" });

      try {
        for await (const { event, data } of sseStream(
          "/api/v1/analytics/stream",
          { session_id: sessionId, message }
        )) {
          switch (event) {
            case "text":
              dispatch({
                type: "TEXT",
                token: (data as { token: string }).token,
              });
              break;

            case "tool_call_start":
              dispatch({
                type: "TOOL_CALL_START",
                node: (data as { node: string }).node,
              });
              break;

            case "tool_call_end":
              dispatch({
                type: "TOOL_CALL_END",
                payload: data as ToolCallEndEvent,
              });
              break;

            case "ui_component":
              dispatch({
                type: "UI_COMPONENT",
                component: data as UIComponent,
              });
              break;

            case "error":
              dispatch({
                type: "ERROR",
                error: (data as { message: string }).message || "Unknown error",
              });
              break;

            case "end":
              dispatch({ type: "END" });
              break;
          }
        }
      } catch (err) {
        dispatch({
          type: "ERROR",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      }
    },
    []
  );

  const reset = useCallback(() => {
    dispatch({ type: "END" });
  }, []);

  return { ...state, send, reset };
}
