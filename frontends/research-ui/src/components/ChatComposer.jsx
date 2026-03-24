import { useState, useRef, useCallback, useEffect } from 'react'
import { SendHorizonal, Square } from 'lucide-react'

export function ChatComposer({ onSend, onStop, isRunning, placeholder }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [value])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isRunning) return
    onSend(value.trim())
    setValue('')
  }, [value, isRunning, onSend])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 bg-slate-50 rounded-xl border border-slate-200 px-4 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isRunning}
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm text-slate-900 placeholder:text-slate-400 outline-none py-1.5 max-h-40 disabled:opacity-50"
            aria-label="Research prompt"
          />

          {isRunning ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              aria-label="Stop generation"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="flex-shrink-0 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              <SendHorizonal size={16} />
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center mt-2">
          Deep Agent will plan, research, and synthesize a response. Press Shift+Enter for new line.
        </p>
      </div>
    </div>
  )
}
