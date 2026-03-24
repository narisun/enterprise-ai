import { useState } from 'react'
import { FileText, Copy, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer.jsx'

export function ArtifactCard({ artifact }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(artifact.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard API may not be available */ }
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 overflow-hidden animate-slide-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-emerald-50 transition-colors"
      >
        <FileText size={14} className="text-emerald-500 flex-shrink-0" />
        <span className="text-sm font-medium text-emerald-700">{artifact.title ?? 'Research Output'}</span>
        <span className="text-xs text-emerald-400 ml-1">({artifact.type})</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-emerald-100 transition-colors"
            aria-label="Copy content"
          >
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="text-emerald-400" />}
          </button>
          {expanded ? <ChevronDown size={14} className="text-emerald-400" /> : <ChevronRight size={14} className="text-emerald-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-emerald-100">
          <div className="mt-2 prose prose-sm prose-slate max-w-none">
            <MarkdownRenderer content={artifact.content} />
          </div>
        </div>
      )}
    </div>
  )
}
