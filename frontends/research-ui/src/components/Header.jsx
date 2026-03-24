import { Search, PlusCircle } from 'lucide-react'

export function Header({ onNewChat }) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white">
          <Search size={16} />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-900">Enterprise Research Agent</h1>
          <p className="text-xs text-slate-500">Plan, execute, review — powered by Deep Agents</p>
        </div>
      </div>

      <button
        onClick={onNewChat}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Start new research"
      >
        <PlusCircle size={16} />
        <span>New Research</span>
      </button>
    </header>
  )
}
