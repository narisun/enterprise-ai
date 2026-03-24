/**
 * ChatView — Main chat container composing message list + input.
 *
 * This is the primary view of the chat-first UI. It replaces the old
 * phase-based OutputCanvas with a conversational message list.
 *
 * Features:
 *   • Scrollable message list with auto-scroll on new content
 *   • Welcome screen when chat is empty
 *   • Live streaming assistant message at bottom
 *   • Completed messages rendered from history
 *   • Chat input bar pinned to bottom
 *   • Pre-fill support — suggestion cards inject text into input
 *   • Always-enabled input — users can type without selecting an agent
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import ChatMessage from './ChatMessage.jsx'
import ChatInput from './ChatInput.jsx'
import WelcomeScreen from './WelcomeScreen.jsx'

export default function ChatView({
  messages,
  liveStream,
  hasLiveResponse,
  isStreaming,
  agent,
  onSend,
  onStop,
  onRetry,
  onSelectAgent,
}) {
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const [prefillText, setPrefillText] = useState('')
  // Counter to force re-trigger prefill even if same text is clicked again
  const [prefillKey, setPrefillKey] = useState(0)

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [
    messages.length,
    hasLiveResponse,
    liveStream?.streamingText,
    liveStream?.steps?.length,
    liveStream?.toolCalls?.length,
    liveStream?.output,
  ])

  // Pre-fill handler — sets text into the ChatInput without sending
  const handlePrefill = useCallback((prompt) => {
    setPrefillText(prompt)
    setPrefillKey((k) => k + 1)
  }, [])

  // Clear prefill after it's consumed
  const handleSend = useCallback((content) => {
    setPrefillText('')
    onSend(content)
  }, [onSend])

  // Direct send from suggestion card arrow button
  const handleSuggestionSend = useCallback((prompt) => {
    setPrefillText('')
    onSend(prompt)
  }, [onSend])

  const isEmpty = messages.length === 0 && !hasLiveResponse

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* ── Message area ────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <WelcomeScreen
            agent={agent}
            onSelectAgent={onSelectAgent}
            onSendMessage={handleSuggestionSend}
            onPrefill={handlePrefill}
          />
        ) : (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Completed messages from history */}
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                agent={agent}
                onRetry={msg.status === 'error' ? onRetry : undefined}
              />
            ))}

            {/* Live streaming assistant message */}
            {hasLiveResponse && (
              <ChatMessage
                liveStream={liveStream}
                agent={agent}
                onRetry={liveStream?.status === 'error' ? onRetry : undefined}
                isLive
              />
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}
      </div>

      {/* ── Input bar — always enabled ────────────────────────────────── */}
      <ChatInput
        onSend={handleSend}
        onStop={onStop}
        isStreaming={isStreaming}
        agent={agent}
        prefill={prefillKey > 0 ? prefillText : ''}
        placeholder={
          agent
            ? `Ask ${agent.workerName} anything...`
            : 'Type a question — the right agent will be selected automatically...'
        }
        disabled={false}
      />
    </div>
  )
}
