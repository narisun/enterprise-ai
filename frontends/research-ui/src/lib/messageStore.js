/**
 * Message store — manages conversation state and bridges to assistant-ui.
 *
 * This is the central state manager that:
 * 1. Maintains the message history (user + assistant turns)
 * 2. Tracks in-progress tool calls, plan updates, and streaming tokens
 * 3. Exposes a subscribe/getSnapshot API for React useSyncExternalStore
 */
import { v4 as uuid } from 'uuid'

/**
 * Create a new message store instance.
 */
export function createMessageStore() {
  let messages = []
  let currentAssistant = null   // In-progress assistant message
  let isRunning = false
  let listeners = new Set()

  // Cached snapshot — useSyncExternalStore requires getSnapshot to return
  // the SAME reference if state hasn't changed, otherwise it infinite-loops.
  let cachedSnapshot = { messages: [], isRunning: false }

  function notify() {
    // Build the new snapshot ONCE per state change, then cache it.
    const visibleMessages = currentAssistant
      ? [...messages, currentAssistant]
      : messages
    cachedSnapshot = { messages: visibleMessages, isRunning }
    listeners.forEach((fn) => fn())
  }

  function getSnapshot() {
    return cachedSnapshot
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function addUserMessage(content) {
    const msg = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    messages = [...messages, msg]
    notify()
    return msg
  }

  function startAssistantMessage() {
    isRunning = true
    currentAssistant = {
      id: uuid(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      plan: null,
      subagents: [],
      artifacts: [],
      thinking: '',
      status: 'streaming',
      timestamp: Date.now(),
    }
    notify()
  }

  function appendToken(text) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      content: currentAssistant.content + text,
    }
    notify()
  }

  function updatePlan(plan) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      plan: { ...plan },
    }
    notify()
  }

  function addToolCall(toolCall) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      toolCalls: [...currentAssistant.toolCalls, toolCall],
    }
    notify()
  }

  function updateToolCall(toolCallId, updates) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      toolCalls: currentAssistant.toolCalls.map((tc) =>
        tc.id === toolCallId ? { ...tc, ...updates } : tc
      ),
    }
    notify()
  }

  function addSubagent(subagent) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      subagents: [...currentAssistant.subagents, subagent],
    }
    notify()
  }

  function updateSubagent(subagentId, updates) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      subagents: currentAssistant.subagents.map((sa) =>
        sa.id === subagentId ? { ...sa, ...updates } : sa
      ),
    }
    notify()
  }

  function addArtifact(artifact) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      artifacts: [...currentAssistant.artifacts, artifact],
    }
    notify()
  }

  function setThinking(text) {
    if (!currentAssistant) return
    currentAssistant = {
      ...currentAssistant,
      thinking: text,
    }
    notify()
  }

  function finishAssistantMessage(finalContent) {
    if (!currentAssistant) return
    const finished = {
      ...currentAssistant,
      content: finalContent ?? currentAssistant.content,
      status: 'complete',
    }
    messages = [...messages, finished]
    currentAssistant = null
    isRunning = false
    notify()
  }

  function setError(error) {
    if (currentAssistant) {
      const errMsg = {
        ...currentAssistant,
        content: currentAssistant.content || 'An error occurred.',
        status: 'error',
        error: error,
      }
      messages = [...messages, errMsg]
      currentAssistant = null
    }
    isRunning = false
    notify()
  }

  function clear() {
    messages = []
    currentAssistant = null
    isRunning = false
    notify()
  }

  return {
    getSnapshot,
    subscribe,
    addUserMessage,
    startAssistantMessage,
    appendToken,
    updatePlan,
    addToolCall,
    updateToolCall,
    addSubagent,
    updateSubagent,
    addArtifact,
    setThinking,
    finishAssistantMessage,
    setError,
    clear,
  }
}
