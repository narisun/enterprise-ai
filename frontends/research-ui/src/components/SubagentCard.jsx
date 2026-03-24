import { useState } from 'react'
import { Bot, Check, Loader, ChevronDown, ChevronRight } from 'lucide-react'

export function SubagentCard({ subagent }) {
  const [expanded, setExpanded] = useState(false)
  const { name, task, status, result } = subagent
  const isRunning = status === 'running'

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 text-xs animate-slide-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors"
      >
        {isRunning ? (
          <Loader size={12} className="text-blue-500 animate-spin flex-shrink-0" />
        ) : (
          <Check size={12} className="text-emerald-500 flex-shrink-0" />
        )}
        <Bot size={12} className="text-blue-500 flex-shrink-0" />
        <span className="text-blue-700 font-medium">{name ?? 'Subagent'}</span>
        {task && (
          <span className="text-blue-400 truncate ml-1">— {task}</span>
        )}
        <span className="ml-auto flex-shrink-0">
          {expanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        </span>
      </button>

      {expanded && result && (
        <div className="px-3 pb-2 border-t border-blue-100">
          <pre className="mt-2 bg-white rounded p-2 text-slate-600 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto text-xs">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
