/**
 * OutputCanvas — Phase 3, right panel (main canvas).
 *
 * States:
 *   streaming, no output  → LiveExecutionDisplay  — live step + thought timeline
 *   streaming, has output → report appeared mid-stream (rare); show it immediately
 *   complete              → ExecutionTrace (collapsed) + final report
 *   error                 → error card
 *   idle                  → empty state
 *
 * Props:
 *   output       — string | null     — final markdown report
 *   clientName   — string | null     — extracted client name (RM Prep)
 *   status       — 'streaming' | 'complete' | 'error' | 'idle'
 *   error        — string | null
 *   onRefine     — (prompt: string) => void
 *   agent        — agent config
 *   steps        — [{id, message, ts}]   — completed pipeline steps
 *   activeStep   — string | null          — step currently executing
 *   thoughts     — [{id, message, verdict, score, issues, missed_signals, ts}]
 */

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import {
  Copy, Download, RefreshCw, Check, SendHorizonal, Zap,
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Lightbulb, Activity,
} from 'lucide-react'

// ── Custom ReactMarkdown renderers ────────────────────────────────────────────
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
  // eslint-disable-next-line no-unused-vars
  code: ({ node, className, children, ...rest }) => {
    const isBlock = Boolean(className)
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

// ── Shared: builds a merged, time-ordered timeline from steps + thoughts ──────
function buildTimeline(steps, thoughts) {
  return [
    ...steps.map((s)  => ({ ...s,  _type: 'step'    })),
    ...thoughts.map((t) => ({ ...t, _type: 'thought' })),
  ].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
}

// ── ThoughtBubble — evaluator insight card ────────────────────────────────────
function ThoughtBubble({ thought }) {
  const [expanded, setExpanded] = useState(false)
  const isPass    = thought.verdict === 'pass'
  const issueCount = (thought.issues?.length ?? 0) + (thought.missed_signals?.length ?? 0)

  return (
    <div className={`rounded-xl border px-4 py-3 ${
      isPass ? 'bg-emerald-50 border-emerald-200' : 'bg-violet-50 border-violet-200'
    }`}>
      <div className="flex items-start gap-3">
        <Lightbulb className={`w-4 h-4 shrink-0 mt-0.5 ${isPass ? 'text-emerald-500' : 'text-violet-500'}`} />
        <div className="flex-1 min-w-0">

          {/* Score badge + headline */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
            }`}>
              {thought.score != null ? `${(thought.score * 100).toFixed(0)}%` : '—'}
            </span>
            <span className={`text-sm font-semibold ${isPass ? 'text-emerald-700' : 'text-violet-700'}`}>
              {thought.message}
            </span>
          </div>

          {/* Expand toggle — only when there's detail to show */}
          {issueCount > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`flex items-center gap-1 text-xs mt-2 font-medium transition-colors ${
                isPass
                  ? 'text-emerald-600 hover:text-emerald-800'
                  : 'text-violet-500 hover:text-violet-700'
              }`}
            >
              {expanded
                ? <><ChevronUp className="w-3 h-3" />Hide details</>
                : <><ChevronDown className="w-3 h-3" />{issueCount} issue{issueCount !== 1 ? 's' : ''} — show details</>}
            </button>
          )}

          {/* Expanded issue list */}
          {expanded && issueCount > 0 && (
            <div className="mt-3 space-y-3 border-t border-violet-100 pt-3">
              {thought.issues?.map((iss, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-slate-700">{iss.client}:</span>
                    <span className={`text-xs px-1.5 py-px rounded font-medium ${
                      iss.problem === 'unsupported'    ? 'bg-red-100 text-red-600' :
                      iss.problem === 'wrong_severity' ? 'bg-amber-100 text-amber-600' :
                                                         'bg-orange-100 text-orange-600'
                    }`}>{iss.problem?.replace('_', ' ')}</span>
                  </div>
                  {iss.claim && (
                    <p className="text-slate-500 italic text-xs mb-1">"{iss.claim}"</p>
                  )}
                  {iss.correction && (
                    <p className="text-violet-600 text-xs">→ {iss.correction}</p>
                  )}
                </div>
              ))}
              {thought.missed_signals?.map((m, i) => (
                <div key={`missed-${i}`} className="text-sm">
                  <span className="font-semibold text-amber-600 text-xs">Missed signal: </span>
                  <span className="text-slate-600 text-xs">{m}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── LiveExecutionDisplay — shown while streaming and no output yet ─────────────
// This replaces the plain skeleton. The RM sees exactly what the agent is doing
// — steps completing, thought bubbles from the Evaluator — in real time.
function LiveExecutionDisplay({ steps, activeStep, thoughts, agent }) {
  const timeline = buildTimeline(steps, thoughts)

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-2xl">{agent?.icon}</span>
        <div>
          <p className="text-base font-semibold text-slate-800">
            {agent?.workerName ?? 'Agent'} is working…
          </p>
          <p className="text-sm text-slate-500">{agent?.workerRole}</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          Running
        </span>
      </div>

      {/* Live timeline */}
      <div className="space-y-3">
        {timeline.map((item) =>
          item._type === 'step' ? (
            <div key={item.id} className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm text-slate-600">{item.message}</span>
            </div>
          ) : (
            <ThoughtBubble key={item.id} thought={item} />
          )
        )}

        {/* Active step */}
        {activeStep && (
          <div className="flex items-center gap-3 py-1">
            <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
            <span className="text-sm font-medium text-blue-700">{activeStep}</span>
          </div>
        )}

        {/* Ghost steps still to come */}
        {!activeStep && steps.length === 0 && (
          <div className="flex items-center gap-3 opacity-40">
            <Loader2 className="w-4 h-4 text-slate-300 shrink-0 animate-spin" />
            <span className="text-sm text-slate-400">Starting up…</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ExecutionTrace — collapsible "how the agent worked" summary ───────────────
// Shown above the final report once complete. Starts collapsed.
function ExecutionTrace({ steps, thoughts, agent }) {
  const [open, setOpen] = useState(false)
  const timeline  = buildTimeline(steps, thoughts)

  // Find the final pass verdict for the summary line
  const lastPass   = [...thoughts].reverse().find((t) => t.verdict === 'pass')
  const totalPasses = thoughts.length

  const summaryParts = []
  if (steps.length)    summaryParts.push(`${steps.length} steps`)
  if (totalPasses > 0) summaryParts.push(`${totalPasses} evaluator pass${totalPasses !== 1 ? 'es' : ''}`)
  if (lastPass)        summaryParts.push(`verified ${(lastPass.score * 100).toFixed(0)}%`)

  return (
    <div className="border border-slate-200 rounded-xl mb-8 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <Activity className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-sm font-medium text-slate-600">
            How {agent?.workerName ?? 'the agent'} worked
          </span>
          {lastPass && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">
              Verified {(lastPass.score * 100).toFixed(0)}%
            </span>
          )}
          <span className="text-xs text-slate-400">{summaryParts.join(' · ')}</span>
        </div>
        {open
          ? <ChevronUp   className="w-4 h-4 text-slate-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>

      {/* Expanded timeline */}
      {open && (
        <div className="px-4 py-4 space-y-3 border-t border-slate-100">
          {timeline.map((item) =>
            item._type === 'step' ? (
              <div key={item.id} className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-sm text-slate-600">{item.message}</span>
              </div>
            ) : (
              <ThoughtBubble key={item.id} thought={item} />
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Skeleton shimmer ──────────────────────────────────────────────────────────
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

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ── Download button ───────────────────────────────────────────────────────────
function DownloadButton({ text, filename }) {
  const handle = () => {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
      <Download className="w-3.5 h-3.5" />
      Download .md
    </button>
  )
}

// ── Refinement bar ────────────────────────────────────────────────────────────
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
      {suggestions?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map((s) => (
            <button key={s}
              onClick={() => { setValue(s); inputRef.current?.focus() }}
              className="text-xs px-3 py-1.5 rounded-full border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors">
              <Zap className="w-3 h-3 inline mr-1 -mt-0.5" />{s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input ref={inputRef} type="text" value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ask a follow-up question or request a change…"
          disabled={isRefining}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 outline-none
            focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400
            disabled:bg-slate-50 disabled:text-slate-400 transition-all"
        />
        <button onClick={submit} disabled={!value.trim() || isRefining}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40
            disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium shrink-0">
          {isRefining
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <SendHorizonal className="w-4 h-4" />}
          {isRefining ? 'Updating…' : 'Ask'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function OutputCanvas({
  output, clientName, status, error, onRefine, agent,
  steps = [], activeStep = null, thoughts = [],
}) {
  const briefRef  = useRef(null)
  const isRefining = status === 'streaming' && !!output

  // Scroll to top when a new report arrives
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
            <span className="text-lg">{agent?.icon}</span>
            <span className="text-sm font-semibold text-slate-700">
              {clientName ? `Brief — ${clientName}` : `${agent?.workerName ?? 'Worker'} · Output`}
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
              filename={`${(agent?.id ?? 'output')}-${(clientName ?? 'report').replace(/\s+/g, '-').toLowerCase()}.md`}
            />
          </div>
        </div>
      )}

      {/* ── Scrollable content area ─────────────────────────────────────── */}
      <div ref={briefRef} className="flex-1 overflow-y-auto px-8 py-6">

        {/* Live execution display — streaming with no output yet */}
        {status === 'streaming' && !output && (
          <LiveExecutionDisplay
            steps={steps}
            activeStep={activeStep}
            thoughts={thoughts}
            agent={agent}
          />
        )}

        {/* Streaming skeleton overlay — output appeared mid-stream (rare) */}
        {status === 'streaming' && output && (
          <div className="flex items-center gap-2 mb-6 text-sm text-blue-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            {agent?.workerName ?? 'Agent'} is updating…
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

        {/* Report + execution trace */}
        {output && (
          <div className="max-w-3xl animate-fade-in">
            {/* Collapsible execution trace — only when agent has actually run steps */}
            {steps.length > 0 && status === 'complete' && (
              <ExecutionTrace steps={steps} thoughts={thoughts} agent={agent} />
            )}

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
            <span className="text-4xl mb-3">{agent?.icon ?? '📋'}</span>
            <p className="text-sm font-medium text-slate-500">{agent?.workerName ?? 'The agent'} is ready</p>
            <p className="text-xs mt-1">Output will appear here once you submit a request.</p>
          </div>
        )}

      </div>

      {/* ── Refinement bar ───────────────────────────────────────────────── */}
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
