import { useState } from 'react'
import { ListTodo, ChevronDown, ChevronRight, Check, Circle, Loader } from 'lucide-react'

const STATUS_ICON = {
  done: <Check size={12} className="text-emerald-500" />,
  in_progress: <Loader size={12} className="text-blue-500 animate-spin" />,
  pending: <Circle size={12} className="text-slate-300" />,
}

export function PlanViewer({ plan }) {
  const [expanded, setExpanded] = useState(true)
  const todos = plan?.todos ?? []

  if (todos.length === 0) return null

  const completed = todos.filter((t) => t.status === 'done').length
  const total = todos.length
  const progress = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden animate-slide-up">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ListTodo size={14} className="text-blue-500" />
          <span className="text-xs font-medium text-slate-700">
            Research Plan
          </span>
          <span className="text-xs text-slate-400">
            {completed}/{total} steps
          </span>
        </div>
        {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
      </button>

      {/* Progress bar */}
      <div className="h-0.5 bg-slate-200">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo list */}
      {expanded && (
        <div className="px-3 py-2 space-y-1">
          {todos.map((todo, i) => (
            <div key={i} className="flex items-start gap-2 py-1">
              <span className="mt-0.5 flex-shrink-0">
                {STATUS_ICON[todo.status] ?? STATUS_ICON.pending}
              </span>
              <span className={`text-xs leading-relaxed ${
                todo.status === 'done' ? 'text-slate-400 line-through' :
                todo.status === 'in_progress' ? 'text-slate-700 font-medium' :
                'text-slate-500'
              }`}>
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
