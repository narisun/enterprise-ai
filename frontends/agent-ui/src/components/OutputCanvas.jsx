/**
 * OutputCanvas — Phase 3, right panel.
 *
 * - While streaming:  shows skeleton shimmer + "Thinking…" indicator
 * - On complete:      renders the markdown brief with copy / download actions
 * - On error:         shows error card with retry hint
 * - At bottom:        RefinementBar for follow-up questions
 *
 * Props:
 *   output       — string | null   — markdown brief
 *   clientName   — string | null   — extracted client name
 *   status       — 'streaming' | 'complete' | 'error' | 'idle'
 *   error        — string | null
 *   onRefine     — (prompt: string) => void
 *   agent        — agent config (for suggested follow-ups)
 */

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Copy, Download, RefreshCw, Check, SendHorizonal, Zap } from 'lucide-react'

// ── Custom renderers for ReactMarkdown ────────────────────────────────────────
// Explicit element map guarantees Tailwind classes are applied at render time
// rather than relying on @apply in CSS (which Tailwind JIT may not pick up if
// the class name never appears directly in JSX).
const MD_COMPONENTS = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-slate-900 mt-0 mb-4 pb-3 border-b border-slate-200">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold text-slate-800 mt-6 mb-3">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-slate-700 mt-4 mb-2">{children}</h3>,
  p:  ({ children }) => <p  className="text-slate-700 leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-3 text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-3 text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em:     ({ children }) => <em className="italic text-slate-700">{children}</em>,
  hr: () => <hr className="border-slate-200 my-4" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-400 pl-4 text-slate-600 italic my-3">{children}</blockquote>
  ),
  // react-markdown v9: `inline` prop removed — distinguish inline vs block
  // by checking whether a `language-*` className is present (block) or absent (inline).
  // We also strip the `node` prop so it never reaches a DOM element.
  // eslint-disable-next-line no-unused-vars
  code: ({ node, className, children, ...rest }) => {
    const isBlock = Boolean(className)   // code blocks have language-xxx className
    return isBlock
      ? <code className="block bg-slate-100 text-slate-800 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre" {...rest}>{children}</code>
      : <code className="bg-slate-100 text-blue-700 px-1.5 py-0.5 rounded text-sm font-mono" {...rest}>{children}</code>
  },
  // eslint-disable-next-line no-unused-vars
  pre: ({ node, children }) => <pre className="mb-3 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold text-slate-700 px-3 py-2 border border-slate-200">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border border-slate-200 text-slate-700">{children}</td>,
  // eslint-disable-next-line no-unused-vars
  a:  ({ node, href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-blue-600 underline hover:text-blue-800" {...rest}>
      {children}
    </a>
  ),
  // eslint-disable-next-line no-unused-vars
  img: ({ node, src, alt, ...rest }) => (
    <img src={src} alt={alt ?? ''} className="max-w-full rounded-lg my-3"
      onError={(e) => { e.currentTarget.style.display = 'none' }} />
  ),
}

// ── Skeleton shimmer while agent is running ──────────────────────────────────
function BriefSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-7 bg-slate-200 rounded-lg w-2/3" />
      <div className="h-3 bg-slate-200 rounded w-full" />
      <div className="h-3 bg-slate-200 rounded w-5/6" />
      <div className="h-3 bg-slate-200 rounded w-4/5" />
      <div className="h-5 bg-slate-200 rounded-lg w-1/3 mt-6" />
      <div className="h-3 bg-slate-200 rounded w-full" />
      <div className="h-3 bg-slate-200 rounded w-3/4" />
      <div className="h-3 bg-slate-200 rounded w-5/6" />
      <div className="h-5 bg-slate-200 rounded-lg w-1/4 mt-6" />
      <div className="h-3 bg-slate-200 rounded w-full" />
      <div className="h-3 bg-slate-200 rounded w-2/3" />
    </div>
  )
}

// ── Copy-to-clipboard button ─────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg
        hover:bg-slate-100 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ── Download markdown button ─────────────────────────────────────────────────
function DownloadButton({ text, filename }) {
  const handle = () => {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg
        hover:bg-slate-100 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      Download .md
    </button>
  )
}

// ── Refinement / follow-up bar ───────────────────────────────────────────────
function RefinementBar({ onSubmit, isRefining, suggestions }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  const submit = () => {
    if (!value.trim() || isRefining) return
    onSubmit(value.trim())
    setValue('')
  }

  return (
    <div className="border-t border-slate-200 bg-white px-6 py-4">
      {/* Suggested follow-ups */}
      {suggestions?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => { setValue(s); inputRef.current?.focus() }}
              className="text-xs px-3 py-1.5 rounded-full border border-blue-200 text-blue-600 bg-blue-50
                hover:bg-blue-100 transition-colors"
            >
              <Zap className="w-3 h-3 inline mr-1 -mt-0.5" />{s}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ask a follow-up question or request a change…"
          disabled={isRefining}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 outline-none
            focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400
            disabled:bg-slate-50 disabled:text-slate-400 transition-all"
        />
        <button
          onClick={submit}
          disabled={!value.trim() || isRefining}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40
            disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium shrink-0"
        >
          {isRefining
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <SendHorizonal className="w-4 h-4" />}
          {isRefining ? 'Updating…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OutputCanvas({ output, clientName, status, error, onRefine, agent }) {
  const briefRef = useRef(null)
  const isRefining = status === 'streaming' && !!output  // re-running with existing output visible

  // Auto-scroll to top when a new brief lands
  useEffect(() => {
    if (status === 'complete' && briefRef.current) {
      briefRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [output, status])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">

      {/* ── Toolbar (only when content exists) ─────────────────────────── */}
      {output && (
        <div className="shrink-0 px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              {clientName ? `Brief — ${clientName}` : 'Meeting Brief'}
            </span>
            {status === 'complete' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Ready</span>
            )}
            {isRefining && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium animate-pulse">
                Updating…
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <CopyButton text={output} />
            <DownloadButton
              text={output}
              filename={`brief-${(clientName ?? 'client').replace(/\s+/g, '-').toLowerCase()}.md`}
            />
          </div>
        </div>
      )}

      {/* ── Scrollable content area ─────────────────────────────────────── */}
      <div ref={briefRef} className="flex-1 overflow-y-auto px-8 py-6">

        {/* Streaming skeleton */}
        {status === 'streaming' && !output && (
          <div>
            <div className="flex items-center gap-2 mb-6 text-sm text-blue-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Agent is working…
            </div>
            <BriefSkeleton />
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-5 max-w-lg">
            <p className="font-semibold text-red-700 text-sm mb-1">Agent returned an error</p>
            <p className="text-sm text-red-600">{error ?? 'An unexpected error occurred.'}</p>
            <p className="text-xs text-red-500 mt-3">Try rephrasing your request using the follow-up bar below.</p>
          </div>
        )}

        {/* Brief output */}
        {output && (
          <div className="max-w-3xl animate-fade-in">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MD_COMPONENTS}
            >
              {output}
            </ReactMarkdown>
          </div>
        )}

        {/* Idle / empty state */}
        {status === 'idle' && !output && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-sm">Your brief will appear here once the agent runs.</p>
          </div>
        )}
      </div>

      {/* ── Refinement bar (always visible once agent has run at least once) ─ */}
      {(status === 'complete' || status === 'error' || isRefining) && (
        <RefinementBar
          onSubmit={onRefine}
          isRefining={isRefining}
          suggestions={status === 'complete' ? agent?.followUps?.slice(0, 3) : []}
        />
      )}
    </div>
  )
}
