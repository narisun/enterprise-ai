/**
 * useAgentStream — React hook that drives the SSE streaming connection to
 * any registered agent backend.
 *
 * ── Refactored Architecture ─────────────────────────────────────────────
 * State is now managed via useReducer with a pure agentStreamReducer,
 * making state transitions explicit, testable, and free of stale closures.
 *
 * ── Responsibilities (this file only) ────────────────────────────────────
 *   • Manage React state via reducer: steps, activeStep, thoughts,
 *     streamingText, output, status, error, thinkingText, thinkingLog, toolCalls
 *   • Provide run() / abort() / reset() to callers
 *   • Dispatch typed SSE events from sseStream into state updates
 *   • Clean up AbortController on unmount (no memory leaks)
 *
 * ── SSE event types handled ───────────────────────────────────────────────
 * See src/types/sseEvents.js for the full contract.
 *
 *   progress       → advance the step timeline
 *   token          → append to streamingText (RM Prep only; enables live typing)
 *   llm_token      → append to thinkingText (real-time LLM reasoning from any node)
 *   tool_activity  → append to toolCalls[] (MCP tool start/end from any node)
 *   brief          → set final output + client name, status → 'complete'
 *   report         → set final output (+ meta stored on data), status → 'complete'
 *   thinking       → append evaluator insight to thoughts[] (Portfolio Watch)
 *   error          → set error message, status → 'error'
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { sseStream } from '../lib/sseStream.js'
import { buildHeaders } from '../api/apiClient.js'
import { nextId } from '../lib/idFactory.js'

// ── Action types ──────────────────────────────────────────────────────────
export const ActionTypes = {
  RESET:            'RESET',
  START:            'START',
  ADVANCE_STEP:     'ADVANCE_STEP',
  FLUSH_ACTIVE:     'FLUSH_ACTIVE',
  APPEND_TOKEN:     'APPEND_TOKEN',
  APPEND_LLM_TOKEN: 'APPEND_LLM_TOKEN',
  FLUSH_THINKING:   'FLUSH_THINKING',
  TOOL_START:       'TOOL_START',
  TOOL_END:         'TOOL_END',
  SET_OUTPUT:       'SET_OUTPUT',
  ADD_THOUGHT:      'ADD_THOUGHT',
  SET_ERROR:        'SET_ERROR',
  COMPLETE:         'COMPLETE',
  ABORT:            'ABORT',
}

// ── Initial state ─────────────────────────────────────────────────────────
export const initialState = {
  steps:         [],
  activeStep:    null,
  thoughts:      [],
  streamingText: '',
  output:        null,
  clientName:    null,
  status:        'idle',   // idle | streaming | complete | error
  error:         null,
  thinkingText:  null,     // { node, text } | null
  thinkingLog:   [],       // [{ id, node, text, ts }]
  toolCalls:     [],       // [{ id, action, tool, node, inputPreview?, outputPreview?, ts }]
  // Internal tracking (not rendered, but part of state for purity)
  _seenSteps:    new Set(),
  _thinkingNode: null,
  _thinkingBuf:  '',
}

// ── Pure reducer ──────────────────────────────────────────────────────────
// Every state transition is explicit and testable.
export function agentStreamReducer(state, action) {
  switch (action.type) {

    case ActionTypes.RESET:
      return { ...initialState, _seenSteps: new Set() }

    case ActionTypes.START:
      return {
        ...initialState,
        _seenSteps: new Set(),
        status: 'streaming',
      }

    case ActionTypes.ADVANCE_STEP: {
      const { message } = action.payload
      if (!message || state._seenSteps.has(message)) return state

      const newSeen = new Set(state._seenSteps)
      newSeen.add(message)

      const newSteps = state.activeStep
        ? [...state.steps, { id: nextId('step'), message: state.activeStep, ts: Date.now() }]
        : state.steps

      return {
        ...state,
        steps:       newSteps,
        activeStep:  message,
        _seenSteps:  newSeen,
      }
    }

    case ActionTypes.FLUSH_ACTIVE: {
      if (!state.activeStep) return state
      return {
        ...state,
        steps: [...state.steps, { id: nextId('step'), message: state.activeStep, ts: Date.now() }],
        activeStep: null,
      }
    }

    case ActionTypes.APPEND_TOKEN:
      return {
        ...state,
        streamingText: state.streamingText + action.payload.text,
      }

    case ActionTypes.APPEND_LLM_TOKEN: {
      const { node, text } = action.payload
      // If node changed, flush old buffer to log
      let log  = state.thinkingLog
      let buf  = state._thinkingBuf
      let prev = state._thinkingNode

      if (prev && prev !== node) {
        if (buf) {
          log = [...log, { id: nextId('think'), node: prev, text: buf, ts: Date.now() }]
        }
        buf = ''
      }

      buf += text

      return {
        ...state,
        thinkingLog:   log,
        thinkingText:  { node, text: buf },
        _thinkingNode: node,
        _thinkingBuf:  buf,
      }
    }

    case ActionTypes.FLUSH_THINKING: {
      if (!state._thinkingNode || !state._thinkingBuf) {
        return { ...state, thinkingText: null, _thinkingNode: null, _thinkingBuf: '' }
      }
      return {
        ...state,
        thinkingLog: [
          ...state.thinkingLog,
          { id: nextId('think'), node: state._thinkingNode, text: state._thinkingBuf, ts: Date.now() },
        ],
        thinkingText:  null,
        _thinkingNode: null,
        _thinkingBuf:  '',
      }
    }

    case ActionTypes.TOOL_START:
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          {
            id:            nextId('tool'),
            action:        'start',
            tool:          action.payload.tool,
            node:          action.payload.node,
            inputPreview:  action.payload.input_preview ?? null,
            outputPreview: null,
            ts:            Date.now(),
          },
        ],
      }

    case ActionTypes.TOOL_END: {
      const { tool, output_preview } = action.payload
      const idx = state.toolCalls.findLastIndex(
        (tc) => tc.tool === tool && tc.action === 'start'
      )
      if (idx >= 0) {
        const updated = [...state.toolCalls]
        updated[idx] = {
          ...updated[idx],
          action:        'end',
          outputPreview: output_preview ?? null,
          endTs:         Date.now(),
        }
        return { ...state, toolCalls: updated }
      }
      // No matching start — add standalone end
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          {
            id:            nextId('tool'),
            action:        'end',
            tool,
            node:          action.payload.node,
            inputPreview:  null,
            outputPreview: output_preview ?? null,
            ts:            Date.now(),
          },
        ],
      }
    }

    case ActionTypes.SET_OUTPUT: {
      // Force any in-flight tool calls to "done"
      const closedTools = state.toolCalls.map((tc) =>
        tc.action === 'start' ? { ...tc, action: 'end' } : tc
      )
      // Flush thinking + active step
      let log = state.thinkingLog
      if (state._thinkingNode && state._thinkingBuf) {
        log = [...log, { id: nextId('think'), node: state._thinkingNode, text: state._thinkingBuf, ts: Date.now() }]
      }
      let steps = state.steps
      if (state.activeStep) {
        steps = [...steps, { id: nextId('step'), message: state.activeStep, ts: Date.now() }]
      }

      return {
        ...state,
        output:        action.payload.markdown ?? '',
        clientName:    action.payload.client_name ?? null,
        status:        'complete',
        toolCalls:     closedTools,
        thinkingLog:   log,
        thinkingText:  null,
        _thinkingNode: null,
        _thinkingBuf:  '',
        steps,
        activeStep:    null,
      }
    }

    case ActionTypes.ADD_THOUGHT:
      return {
        ...state,
        thoughts: [
          ...state.thoughts,
          {
            id:             nextId('thought'),
            ts:             Date.now(),
            message:        action.payload.message,
            verdict:        action.payload.verdict,
            score:          action.payload.score,
            issues:         action.payload.issues         ?? [],
            missed_signals: action.payload.missed_signals ?? [],
            phase:          action.payload.phase,
          },
        ],
      }

    case ActionTypes.SET_ERROR: {
      // Flush thinking + active step on error too
      let log = state.thinkingLog
      if (state._thinkingNode && state._thinkingBuf) {
        log = [...log, { id: nextId('think'), node: state._thinkingNode, text: state._thinkingBuf, ts: Date.now() }]
      }
      let steps = state.steps
      if (state.activeStep) {
        steps = [...steps, { id: nextId('step'), message: state.activeStep, ts: Date.now() }]
      }
      return {
        ...state,
        error:         action.payload.message ?? 'Unknown error from agent',
        status:        'error',
        thinkingLog:   log,
        thinkingText:  null,
        _thinkingNode: null,
        _thinkingBuf:  '',
        steps,
        activeStep:    null,
      }
    }

    case ActionTypes.COMPLETE:
      return { ...state, status: state.status === 'streaming' ? 'complete' : state.status }

    case ActionTypes.ABORT:
      return { ...state, status: 'idle', activeStep: null }

    default:
      return state
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useAgentStream() {
  const [state, dispatch] = useReducer(agentStreamReducer, initialState)
  const abortRef = useRef(null)

  // ── Cleanup on unmount — prevents memory leaks ──────────────────────────
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // ── Public API ──────────────────────────────────────────────────────────
  const run = useCallback(async ({ endpoint, body }) => {
    dispatch({ type: ActionTypes.START })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      for await (const { type, data } of sseStream(endpoint, body, buildHeaders(), controller.signal)) {

        if (type === 'progress') {
          dispatch({ type: ActionTypes.ADVANCE_STEP, payload: { message: data.message } })

        } else if (type === 'token') {
          dispatch({ type: ActionTypes.APPEND_TOKEN, payload: { text: data.text } })

        } else if (type === 'llm_token') {
          dispatch({ type: ActionTypes.APPEND_LLM_TOKEN, payload: { node: data.node ?? 'unknown', text: data.text } })

        } else if (type === 'tool_activity') {
          if (data.action === 'end') {
            dispatch({ type: ActionTypes.TOOL_END, payload: data })
          } else {
            dispatch({ type: ActionTypes.TOOL_START, payload: data })
          }

        } else if (type === 'brief' || type === 'report') {
          dispatch({ type: ActionTypes.SET_OUTPUT, payload: data })

        } else if (type === 'thinking') {
          dispatch({ type: ActionTypes.ADD_THOUGHT, payload: data })

        } else if (type === 'error') {
          dispatch({ type: ActionTypes.SET_ERROR, payload: data })
        }
      }

      // Stream closed cleanly without a final event
      dispatch({ type: ActionTypes.COMPLETE })

    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('[useAgentStream]', err)
      dispatch({ type: ActionTypes.SET_ERROR, payload: { message: err.message } })
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: ActionTypes.ABORT })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: ActionTypes.RESET })
  }, [])

  return {
    // Public state (excludes internal _prefixed fields)
    steps:         state.steps,
    activeStep:    state.activeStep,
    thoughts:      state.thoughts,
    streamingText: state.streamingText,
    output:        state.output,
    clientName:    state.clientName,
    thinkingText:  state.thinkingText,
    thinkingLog:   state.thinkingLog,
    toolCalls:     state.toolCalls,
    status:        state.status,
    error:         state.error,
    // Actions
    run,
    abort,
    reset,
  }
}
