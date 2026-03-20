/**
 * OutputCanvas — full-width response canvas, Phase 3.
 *
 * ── Visual states ─────────────────────────────────────────────────────────
 *
 *  idle          Empty state with agent icon
 *
 *  streaming     ThinkingBlock (auto-expanded, shows current step label)
 *  + no tokens   The agent is doing background work (data fetching, routing…)
 *
 *  streaming     ThinkingBlock (auto-collapsed to a single "Alex thought…" line)
 *  + tokens      Markdown building up word-by-word with a blinking cursor
 *
 *  complete      ThinkingBlock (collapsed, user can expand) + full output
 *
 *  error         Error card
 *
 * ── ThinkingBlock behaviour ───────────────────────────────────────────────
 * Mirrors what users recognise from Claude, ChatGPT, and Gemini:
 *   • Expands automatically when the agent starts doing background work
 *   • Collapses automatically the moment output tokens start arriving
 *   • After completion, stays collapsed — user can re-open to inspect steps
 *
 * ── Token streaming ───────────────────────────────────────────────────────
 * RM Prep emits `token` events from its `synthesize` LLM node.  The hook
 * accumulates them into `streamingText`.  Once the authoritative `brief`
 * event arrives, `output` is set and `streamingText` is superseded — the
 * transition is invisible to the user because the text is the same.
 *
 * Portfolio Watch does not emit `token` events (revision loop would produce
 * confusing partial drafts), so `streamingText` is always empty for Morgan.
 *
 * Props:
 *   output       — string | null    — final authoritative markdown
 *   streamingText — string          — live token buffer (empty when not streaming)
 *   clientName   — string | null    — extracted client name (RM Prep)
 *   status       — 'streaming' | 'complete' | 'error' | 'idle'
 *   error        — string | null
 *   onRefine     — (prompt: string) => void
 *   agent        — agent display config
 *   steps        — [{id, message, ts}]
 *   activeStep   — string | null
 *   thoughts     — [{id, message, verdict, score, issues, missed_signals, ts}]
 */

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import {
  Copy, Download, RefreshCw, Check, SendHorizonal, Zap,
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Lightbulb,
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

// ── Merge steps + thoughts into a single time-ordered timeline ────────────────
function buildTimeline(steps, thoughts) {
  return [
    ...steps.map((s)  => ({ ...s,  _type: 'step'    })),
    ...thoughts.map((t) => ({ ...t, _type: 'thought' })),
  ].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
}

// ── ThoughtBubble — evaluator fact-check card (Portfolio Watch) ───────────────
function ThoughtBubble({ thought }) {
  const [expanded, setExpanded] = useState(false)
  const isPass     = thought.verdict === 'pass'
  const issueCount = (thought.issues?.length ?? 0) + (thought.missed_signals?.length ?? 0)

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      isPass ? 'bg-emerald-50 border-emerald-200' : 'bg-violet-50 border-violet-200'
    }`}>
      <div className="flex items-start gap-2.5">
        <Lightbulb className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isPass ? 'text-emerald-500' : 'text-violet-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-1.5 py-px rounded-full ${
              isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
            }`}>
              {thought.score != null ? `${(thought.score * 100).toFixed(0)}%` : '—'}
            </span>
            <span className={`text-xs font-medium ${isPass ? 'text-emerald-700' : 'text-violet-700'}`}>
              {thought.message}
            </span>
          </div>

          {issueCount > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`flex items-center gap-1 text-xs mt-1.5 font-medium transition-colors ${
                isPass ? 'text-emerald-600 hover:text-emerald-800' : 'text-violet-500 hover:text-violet-700'
              }`}
            >
              {expanded
                ? <><ChevronUp className="w-3 h-3" />Hide details</>
                : <><ChevronDown className="w-3 h-3" />{issueCount} issue{issueCount !== 1 ? 's' : ''} — show details</>}
            </button>
          )}

          {expanded && issueCount > 0 && (
            <div className="mt-2 space-y-2 border-t border-violet-100 pt-2">
              {thought.issues?.map((iss, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="font-semibold text-slate-700">{iss.client}:</span>
                    <span className={`px-1.5 py-px rounded font-medium ${
                      iss.problem === 'unsupported'    ? 'bg-red-100 text-red-600' :
                      iss.problem === 'wrong_severity' ? 'bg-amber-100 text-amber-600' :
                                                         'bg-orange-100 text-orange-600'
                    }`}>{iss.problem?.replace('_', ' ')}</span>
                  </div>
                  {iss.claim      && <p className="text-slate-500 italic mb-0.5">"{iss.claim}"</p>}
                  {iss.correction && <p className="text-violet-600">→ {iss.correction}</p>}
                </div>
              ))}
              {thought.missed_signals?.map((m, i) => (
                <div key={`missed-${i}`} className="text-xs">
                  <span className="font-semibold text-amber-600">Missed signal: </span>
                  <span className="text-slate-600">{m}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ThinkingBlock ─────────────────────────────────────────────────────────────
//
// The single collapsible "thinking" indicator that replaces the separate
// ExecutionRail panel.  Behaviour mirrors Claude / ChatGPT / Gemini:
//
//   • Auto-expands while the agent is doing background work (no tokens yet)
//   • Auto-collapses the moment output tokens start arriving
//   • Stays collapsed after completion — user can expand to inspect steps
//
function ThinkingBlock({ steps, activeStep, thoughts, agent, status, hasTokens }) {
  const isStreaming = status === 'streaming'
  const isDone      = status === 'complete' || status === 'error'
  const [open, setOpen] = useState(false)

  // Auto-expand while thinking (no tokens), auto-collapse when output starts
  useEffect(() => {
    if (isStreaming && !hasTokens && (steps.length > 0 || !!activeStep)) {
      setOpen(true)
    }
    if (hasTokens || isDone) {
      setOpen(false)
    }
  }, [isStreaming, hasTokens, isDone, steps.length, activeStep])

  const timeline    = buildTimeline(steps, thoughts)
  const hasContent  = timeline.length > 0 || !!activeStep
  if (!hasContent) return null

  // Collapsed header text
  const headerText = (isStreaming && !hasTokens)
    ? (activeStep ?? `${agent?.workerName ?? 'Agent'} is thinking…`)
    : `${agent?.workerName ?? 'Agent'} thought for ${steps.length} step${steps.length !== 1 ? 's' : ''}`

  // Verification badge (Portfolio Watch evaluator)
  const lastPass = [...thoughts].reverse().find((t) => t.verdict === 'pass')

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-100 transition-colors text-left"
      >
        {/* Spinner while thinking, check when done */}
        {isStreaming && !hasTokens
          ? <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        }

        <span className="flex-1 text-sm font-medium text-slate-700 truncate">{headerText}</span>

        {/* Step count chip */}
        {steps.length > 0 && (
          <span className="text-xs text-slate-400 shrink-0">
            {steps.length} step{steps.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Evaluator verification badge */}
        {lastPass && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium shrink-0">
            {(lastPass.score * 100).toFixed(0)}% verified
          </span>
        )}

        {open
          ? <ChevronUp   className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-3 space-y-2.5">
          {timeline.map((item) =>
            item._type === 'step' ? (
              <div key={item.id} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-sm text-slate-600">{item.message}</span>
              </div>
            ) : (
              <ThoughtBubble key={item.id} thought={item} />
            )
          )}
          {activeStep && (
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
              <span className="text-sm font-medium text-blue-700">{activeStep}</span>
            </div>
          )}
        </div>
      )}
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
    <div className="border-t border-slate-200 bg-slate-50 px-6 pt-4 pb-6">
      {suggestions?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {suggestions.map((s) => (
            <button key={s}
              onClick={() => { setValue(s); inputRef.current?.focus() }}
              className="text-sm px-4 py-2 rounded-full border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors">
              <Zap className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />{s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-3">
        <input ref={inputRef} type="text" value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ask a follow-up question or request a change…"
          disabled={isRefining}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3.5 text-sm text-slate-800 outline-none
            focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400
            disabled:bg-slate-50 disabled:text-slate-400 transition-all"
        />
        <button onClick={submit} disabled={!value.trim() || isRefining}
          className="px-5 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40
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
  output, streamingText = '', clientName, status, error, onRefine, agent,
  steps = [], activeStep = null, thoughts = [],
}) {
  const canvasRef  = useRef(null)
  const hasOutput  = !!output
  const hasTokens  = !!streamingText
  const isRefining = status === 'streaming' && hasOutput
  const isDone     = status === 'complete'

  // Scroll to top when a completed response arrives
  useEffect(() => {
    if (isDone && canvasRef.current) {
      canvasRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [isDone, output])

  // Auto-scroll to the bottom while tokens are streaming in
  const streamingBottomRef = useRef(null)
  useEffect(() => {
    if (hasTokens && !hasOutput) {
      streamingBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streamingText, hasTokens, hasOutput])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {hasOutput && (
        <div className="shrink-0 px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-lg">{agent?.icon}</span>
            <span className="text-sm font-semibold text-slate-700">
              {clientName ? `Brief — ${clientName}` : `${agent?.workerName ?? 'Worker'} · Output`}
            </span>
            {isDone && (
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

      {/* ── Scrollable canvas ────────────────────────────────────────────── */}
      <div ref={canvasRef} className="flex-1 overflow-y-auto px-8 py-6">

        {/* ── Idle state ────────────────────────────────────────────────── */}
        {status === 'idle' && !hasOutput && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <span className="text-4xl mb-3">{agent?.icon ?? '📋'}</span>
            <p className="text-sm font-medium text-slate-500">{agent?.workerName ?? 'The agent'} is ready</p>
            <p className="text-xs mt-1">Output will appear here once you submit a request.</p>
          </div>
        )}

        {/* ── First-frame spinner (before first progress event arrives) ─── */}
        {status === 'streaming' && !hasTokens && !steps.length && !activeStep && (
          <div className="flex items-center gap-3 text-slate-500 mb-5">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
            <span className="text-sm font-medium">{agent?.workerName ?? 'Agent'} is starting up…</span>
          </div>
        )}

        {/* ── Thinking block (replaces ExecutionRail) ───────────────────── */}
        {/*    Shown whenever there are steps, thoughts, or an activeStep.    */}
        {/*    Auto-expands while thinking, auto-collapses when tokens start. */}
        <ThinkingBlock
          steps={steps}
          activeStep={activeStep}
          thoughts={thoughts}
          agent={agent}
          status={status}
          hasTokens={hasTokens || hasOutput}
        />

        {/* ── Live token stream ─────────────────────────────────────────── */}
        {/*    Visible only while RM Prep is synthesising and no final        */}
        {/*    output has arrived yet.  Portfolio Watch skips this state      */}
        {/*    entirely (it has no `token` events).                           */}
        {hasTokens && !hasOutput && (
          <div className="max-w-3xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MD_COMPONENTS}
            >
              {streamingText}
            </ReactMarkdown>
            {/* Blinking cursor — disappears when final output replaces this */}
            <span className="inline-block w-0.5 h-[1.1em] bg-blue-500 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
            <div ref={streamingBottomRef} />
          </div>
        )}

        {/* ── Error state ───────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-5 max-w-lg mt-2">
            <p className="font-semibold text-red-700 text-sm mb-1">Agent returned an error</p>
            <p className="text-sm text-red-600">{error ?? 'An unexpected error occurred.'}</p>
            <p className="text-xs text-red-500 mt-3">Try rephrasing your request using the follow-up bar below.</p>
          </div>
        )}

        {/* ── Final output ─────────────────────────────────────────────── */}
        {/*    Replaces the token stream when the authoritative brief/report   */}
        {/*    event arrives.  Also shown directly (no token phase) for        */}
        {/*    Portfolio Watch and on follow-up refinement runs.               */}
        {hasOutput && (
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

      </div>

      {/* ── Refinement bar ───────────────────────────────────────────────── */}
      {(isDone || status === 'error' || isRefining) && (
        <RefinementBar
          onSubmit={onRefine}
          isRefining={isRefining}
          suggestions={isDone ? agent?.followUps?.slice(0, 3) : []}
        />
      )}
    </div>
  )
}
