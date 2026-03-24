/**
 * ChatInput — Bottom input bar for the chat interface.
 *
 * Features:
 *   • Auto-expanding textarea (grows with content, max 6 rows)
 *   • Send on Enter (Shift+Enter for newline)
 *   • Stop button during streaming
 *   • Agent badge showing which agent will respond
 *   • Pre-fill support — parent can inject text via `prefill` prop
 *   • Always enabled — intent router handles agent selection
 *   • Accessible with ARIA labels
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { SendHorizonal, Square, Sparkles } from 'lucide-react'

export default function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  agent = null,
  placeholder = 'Ask anything...',
  disabled = false,
  prefill = '',
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  // Apply prefill when it changes (from WelcomeScreen suggestion click)
  useEffect(() => {
    if (prefill) {
      setValue(prefill)
      // Focus the textarea so user can edit before sending
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [prefill])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  // Focus on mount and after streaming stops
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus()
    }
  }, [isStreaming])

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming || disabled) return
    onSend(value.trim())
    setValue('')
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, isStreaming, disabled, onSend])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 sm:px-6 py-3">
      {/* Agent badge */}
      {agent && (
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <Sparkles className="w-3 h-3 text-blue-500" />
          <span className="text-xs text-slate-400">
            Responding as <span className="font-medium text-slate-600">{agent.workerName}</span>
          </span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isStreaming || disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 pr-12 text-sm text-slate-800
              outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400
              disabled:bg-slate-50 disabled:text-slate-400 transition-all leading-relaxed"
            aria-label="Type your message"
          />
        </div>

        {isStreaming ? (
          <button
            onClick={onStop}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl
              bg-red-500 hover:bg-red-600 text-white transition-colors"
            aria-label="Stop generating"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl
              bg-blue-600 hover:bg-blue-700 text-white transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        )}
      </div>

      <p className="text-[10px] text-slate-400 text-center mt-2">
        AI-generated content may contain errors. Always verify important information.
      </p>
    </div>
  )
}
