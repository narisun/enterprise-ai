/**
 * useResearchAgent — drives the deep agent via SSE and manages message state.
 *
 * Consumes SSE events from the researcher backend and dispatches them
 * into the messageStore, which assistant-ui components read via snapshot.
 */
import { useState, useRef, useCallback, useMemo, useSyncExternalStore } from 'react'
import { v4 as uuid } from 'uuid'
import { sseStream } from '../lib/sseStream.js'
import { createMessageStore } from '../lib/messageStore.js'

export function useResearchAgent() {
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = createMessageStore()
  }
  const store = storeRef.current

  const [sessionId] = useState(() => uuid())
  const abortRef = useRef(null)

  const { messages, isRunning } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  )

  const sendMessage = useCallback(async (content) => {
    // Add user message
    store.addUserMessage(content)
    store.startAssistantMessage()

    // Create abort controller
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const stream = sseStream({
        url: '/api/research',
        body: {
          prompt: content,
          session_id: sessionId,
          messages: messages
            .filter((m) => m.role === 'user')
            .map((m) => ({ role: m.role, content: m.content })),
        },
        signal: controller.signal,
      })

      for await (const event of stream) {
        if (controller.signal.aborted) break

        switch (event.type) {
          case 'plan_update':
            store.updatePlan(event.data)
            break

          case 'tool_start':
            store.addToolCall({
              id: event.data.id ?? uuid(),
              name: event.data.tool,
              args: event.data.args,
              status: 'running',
              startedAt: Date.now(),
            })
            break

          case 'tool_end':
            store.updateToolCall(event.data.id, {
              status: 'complete',
              result: event.data.result,
              endedAt: Date.now(),
            })
            break

          case 'subagent_start':
            store.addSubagent({
              id: event.data.id ?? uuid(),
              name: event.data.name,
              task: event.data.task,
              status: 'running',
              startedAt: Date.now(),
            })
            break

          case 'subagent_end':
            store.updateSubagent(event.data.id, {
              status: 'complete',
              result: event.data.result,
              endedAt: Date.now(),
            })
            break

          case 'token':
            store.appendToken(event.data.text ?? event.data.content ?? '')
            break

          case 'thinking':
            store.setThinking(event.data.text ?? '')
            break

          case 'artifact':
            store.addArtifact({
              id: event.data.id ?? uuid(),
              title: event.data.title,
              content: event.data.content,
              type: event.data.type ?? 'markdown',
            })
            break

          case 'done':
            store.finishAssistantMessage(event.data.content ?? null)
            break

          case 'error':
            store.setError(event.data.message ?? 'Unknown error')
            break

          default:
            // Unknown event — try to extract text
            if (event.data?.text) {
              store.appendToken(event.data.text)
            }
        }
      }

      // If stream ended without explicit 'done', finish
      if (store.getSnapshot().isRunning) {
        store.finishAssistantMessage(null)
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        store.setError(err.message)
      }
    }
  }, [store, sessionId, messages])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    if (store.getSnapshot().isRunning) {
      store.finishAssistantMessage(null)
    }
  }, [store])

  const clearChat = useCallback(() => {
    store.clear()
  }, [store])

  return {
    messages,
    isRunning,
    sendMessage,
    abort,
    clearChat,
    sessionId,
  }
}
