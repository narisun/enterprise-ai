import { useState } from 'react'
import { Wrench, Check, Loader, ChevronDown, ChevronRight } from 'lucide-react'

const TOOL_LABELS = {
  web_search: 'Web Search',
  read_file: 'Reading File',
  write_file: 'Writing File',
  edit_file: 'Editing File',
  execute: 'Running Command',
  ls: 'Listing Files',
  glob: 'Finding Files',
  grep: 'Searching Content',
  compact_conversation: 'Compacting Context',
}

export function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = useState(false)
  const { name, args, status, result } = toolCall
  const isRunning = status === 'running'

  const label = TOOL_LABELS[name] ?? name

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-xs animate-slide-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        {isRunning ? (
          <Loader size={12} className="text-blue-500 animate-spin flex-shrink-0" />
        ) : (
          <Check size={12} className="text-emerald-500 flex-shrink-0" />
        )}
        <Wrench size={12} className="text-slate-400 flex-shrink-0" />
        <span className="text-slate-700 font-medium">{label}</span>
        {args?.query && (
          <span className="text-slate-400 truncate ml-1">— {args.query}</span>
        )}
        {args?.path && (
          <span className="text-slate-400 truncate ml-1">— {args.path}</span>
        )}
        <span className="ml-auto flex-shrink-0">
          {expanded ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1 border-t border-slate-100">
          {args && (
            <div className="mt-2">
              <span className="text-slate-400">Input:</span>
              <pre className="mt-1 bg-slate-50 rounded p-2 text-slate-600 overflow-x-auto whitespace-pre-wrap">
                {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <span className="text-slate-400">Output:</span>
              <pre className="mt-1 bg-slate-50 rounded p-2 text-slate-600 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
