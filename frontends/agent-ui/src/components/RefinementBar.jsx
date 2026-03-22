/**
 * RefinementBar — Follow-up input bar for refining agent output.
 *
 * Extracted from OutputCanvas.jsx. Features:
 *   • Quick-action suggestion chips
 *   • Keyboard submit (Enter)
 *   • Loading state with spinner
 *   • Proper aria labels for accessibility
 */

import { useState, useRef } from 'react'
import { RefreshCw, SendHorizonal, Zap } from 'lucide-react'

export default function RefinementBar({ onSubmit, isRefining, suggestions = [] }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  const submit = () => {
    if (!value.trim() || isRefining) return
    onSubmit(value.trim())
    setValue('')
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/80 backdrop-blur-sm px-6 pt-4 pb-6">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Suggested follow-up questions">
          {suggestions.map((s) => (
            <button key={s}
              onClick={() => { setValue(s); inputRef.current?.focus() }}
              className="text-sm px-4 py-2 rounded-full border border-blue-200 text-blue-600 bg-blue-50
                hover:bg-blue-100 hover:border-blue-300 transition-all duration-150 hover:shadow-sm">
              <Zap className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />{s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-3">
        <label htmlFor="refinement-input" className="sr-only">Follow-up question</label>
        <input
          ref={inputRef}
          id="refinement-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ask a follow-up question or request a change\u2026"
          disabled={isRefining}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3.5 text-sm text-slate-800 outline-none
            focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400
            disabled:bg-slate-50 disabled:text-slate-400 transition-all"
        />
        <button
          onClick={submit}
          disabled={!value.trim() || isRefining}
          aria-label={isRefining ? 'Updating response' : 'Send follow-up question'}
          className="px-5 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40
            disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium shrink-0"
        >
          {isRefining
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <SendHorizonal className="w-4 h-4" />}
          {isRefining ? 'Updating\u2026' : 'Ask'}
        </button>
      </div>
    </div>
  )
}
