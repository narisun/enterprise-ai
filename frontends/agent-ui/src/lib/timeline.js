/**
 * timeline.js — Pure utility for merging heterogeneous timeline entries.
 *
 * Extracted from OutputCanvas.jsx so it can be unit-tested independently.
 *
 * @module lib/timeline
 */

/**
 * Merge steps, thoughts, LLM thinking segments, and tool calls into a
 * single time-ordered timeline for display in the ThinkingBlock.
 *
 * @param {Array} steps       — completed pipeline steps [{id, message, ts}]
 * @param {Array} thoughts    — evaluator insights [{id, message, verdict, …, ts}]
 * @param {Array} thinkingLog — completed LLM thinking segments [{id, node, text, ts}]
 * @param {Array} toolCalls   — MCP tool call entries [{id, action, tool, …, ts}]
 * @returns {Array} Merged, time-sorted array with _type annotations
 */
export function buildTimeline(steps = [], thoughts = [], thinkingLog = [], toolCalls = []) {
  return [
    ...steps.map((s)       => ({ ...s,  _type: 'step'     })),
    ...thoughts.map((t)    => ({ ...t,  _type: 'thought'  })),
    ...thinkingLog.map((l) => ({ ...l,  _type: 'llm'      })),
    ...toolCalls.map((tc)  => ({ ...tc, _type: 'tool'     })),
  ].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
}
