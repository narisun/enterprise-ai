/**
 * useChat — Manages multi-turn conversation state for a chat-first UI.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 * Replaces the single-shot useAgentStream flow with a message-based model:
 *
 *   messages: [
 *     { id, role: 'user',      content, timestamp },
 *     { id, role: 'assistant', content, agentId, status,
 *       steps, toolCalls, thinkingLog, thoughts, timestamp },
 *     ...
 *   ]
 *
 * During streaming, the "current" assistant response is tracked separately
 * via useAgentStream and rendered as the last bubble. On completion, the
 * stream state is snapshotted into a proper message and appended.
 *
 * The session_id stays constant across the conversation so the LangGraph
 * backend accumulates state via its checkpointer.
 *
 * @module hooks/useChat
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAgentStream } from './useAgentStream.js'
import { getAgentClient } from '../api/agentClients.js'
import { nextId } from '../lib/idFactory.js'

/**
 * @param {object} options
 * @param {string} options.sessionId  — stable session UUID from useSession
 * @param {string} options.rmId       — RM identifier
 * @param {string|null} options.personaJwt — optional test persona JWT
 */
export function useChat({ sessionId, rmId, personaJwt }) {
  const [messages, setMessages] = useState([])
  const [activeAgentId, setActiveAgentId] = useState(null)
  // Track whether we have a pending response — as STATE so it triggers re-renders
  const [hasPending, setHasPending] = useState(false)
  const stream = useAgentStream()

  // When stream completes or errors, snapshot into messages
  useEffect(() => {
    if (
      (stream.status === 'complete' || stream.status === 'error') &&
      hasPending
    ) {
      const assistantMsg = {
        id: nextId('msg'),
        role: 'assistant',
        agentId: activeAgentId,
        content: stream.output ?? stream.streamingText ?? '',
        clientName: stream.clientName,
        status: stream.status,
        error: stream.error,
        steps: [...stream.steps],
        toolCalls: [...stream.toolCalls],
        thinkingLog: [...stream.thinkingLog],
        thoughts: [...stream.thoughts],
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, assistantMsg])
      setHasPending(false)
      // Don't reset the stream yet — keep it so the last message renders
      // with the complete state until the user sends another message
    }
  }, [stream.status, stream.output, stream.streamingText, stream.clientName,
      stream.error, stream.steps, stream.toolCalls, stream.thinkingLog,
      stream.thoughts, activeAgentId, hasPending])

  /**
   * Send a message to the active agent.
   *
   * @param {string} content — user's message text
   * @param {object} agent   — agent config from agents.js
   */
  const sendMessage = useCallback(async (content, agent) => {
    if (!content.trim() || !agent) return

    // Reset stream from any previous completed response
    stream.reset()

    const agentId = agent.id
    setActiveAgentId(agentId)

    // Append user message
    const userMsg = {
      id: nextId('msg'),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setHasPending(true)

    // Fire the stream
    const client = getAgentClient(agentId)
    await stream.run({
      endpoint: client.endpoint,
      body: client.buildRequest(content.trim(), rmId, sessionId, personaJwt),
    })
  }, [rmId, sessionId, personaJwt, stream])

  /**
   * Retry the last failed message.
   */
  const retry = useCallback(async (agent) => {
    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg || !agent) return

    // Remove the failed assistant message
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant' && last?.status === 'error') {
        return prev.slice(0, -1)
      }
      return prev
    })

    await sendMessage(lastUserMsg.content, agent)
  }, [messages, sendMessage])

  /**
   * Clear all messages and start a new conversation.
   */
  const clearChat = useCallback(() => {
    stream.reset()
    setMessages([])
    setActiveAgentId(null)
    setHasPending(false)
  }, [stream])

  /**
   * Whether we are currently streaming a response.
   */
  const isStreaming = stream.status === 'streaming'

  /**
   * Whether there is a live response being streamed or just completed
   * that should be rendered as the last assistant bubble.
   * Uses `hasPending` state (not a ref) so this triggers re-renders.
   */
  const hasLiveResponse = stream.status === 'streaming' ||
    (hasPending && (stream.status === 'complete' || stream.status === 'error'))

  return {
    messages,
    isStreaming,
    hasLiveResponse,
    activeAgentId,
    // Live stream state for the current in-progress response
    liveStream: {
      output: stream.output,
      streamingText: stream.streamingText,
      clientName: stream.clientName,
      status: stream.status,
      error: stream.error,
      steps: stream.steps,
      activeStep: stream.activeStep,
      toolCalls: stream.toolCalls,
      thinkingLog: stream.thinkingLog,
      thinkingText: stream.thinkingText,
      thoughts: stream.thoughts,
    },
    // Actions
    sendMessage,
    retry,
    clearChat,
    abort: stream.abort,
  }
}
