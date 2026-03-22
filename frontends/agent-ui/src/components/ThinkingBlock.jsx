/**
 * ThinkingBlock — Collapsible timeline of agent activity.
 *
 * Industry-standard collapsed-by-default thinking indicator, matching
 * patterns from Claude, ChatGPT, and Gemini:
 *   • COLLAPSED by default — never auto-expands
 *   • Shows a single-line summary of current activity on the header
 *   • User clicks to expand and see the full activity timeline
 *   • After completion, shows step count and verification badge
 *
 * Extracted from OutputCanvas.jsx for testability and reuse.
 */

import { useState } from 'react'
import {
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Lightbulb, Zap,
} from 'lucide-react'
import { buildTimeline } from '../lib/timeline.js'
import { NODE_LABELS } from '../lib/nodeLabels.js'

// ── ThoughtBubble — evaluator fact-check card (Portfolio Watch) ───────────
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
              {thought.score != null ? `${(thought.score * 100).toFixed(0)}%` : '\u2014'}
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
              aria-expanded={expanded}
            >
              {expanded
                ? <><ChevronUp className="w-3 h-3" />Hide details</>
                : <><ChevronDown className="w-3 h-3" />{issueCount} issue{issueCount !== 1 ? 's' : ''} \u2014 show details</>}
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
                  {iss.correction && <p className="text-violet-600">\u2192 {iss.correction}</p>}
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

// ── LLMThinkingBubble — shows a completed or live LLM thinking segment ──
function LLMThinkingBubble({ node, text, isLive = false }) {
  const [expanded, setExpanded] = useState(false)
  const label  = NODE_LABELS[node] ?? node
  const maxLen = 120
  const isLong  = text.length > maxLen
  const preview = isLong ? text.slice(0, maxLen) + '\u2026' : text

  return (
    <div className={`rounded-lg border px-3 py-2 ${
      isLive ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
    }`}>
      <div className="flex items-start gap-2">
        {isLive
          ? <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0 mt-1" />
          : <Zap className="w-3 h-3 text-amber-500 shrink-0 mt-1" />
        }
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-semibold ${isLive ? 'text-blue-700' : 'text-slate-600'}`}>
            {label}
            {isLive && <span className="ml-1.5 font-normal text-blue-500 animate-pulse">thinking\u2026</span>}
          </span>
          <p className="text-xs text-slate-500 mt-0.5 font-mono leading-relaxed whitespace-pre-wrap break-words">
            {expanded ? text : preview}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-blue-500 hover:text-blue-700 mt-1 font-medium"
              aria-expanded={expanded}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ToolCallBubble — shows an MCP tool call (paired start→done) ──────────
function ToolCallBubble({ action, tool, node, inputPreview, outputPreview }) {
  const [expanded, setExpanded] = useState(false)
  const isDone     = action === 'end'
  const nodeLabel  = NODE_LABELS[node] ?? node
  const detail     = isDone ? (outputPreview || inputPreview) : inputPreview

  return (
    <div className={`rounded-lg border px-3 py-2 ${
      isDone ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start gap-2">
        {isDone
          ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
          : <Loader2 className="w-3 h-3 text-amber-500 animate-spin shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs font-bold font-mono px-1.5 py-px rounded ${
              isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {tool}
            </span>
            <span className="text-xs text-slate-400">{nodeLabel}</span>
            {isDone
              ? <span className="text-xs text-emerald-600 font-medium">done</span>
              : <span className="text-xs text-amber-600 font-medium">calling\u2026</span>
            }
          </div>
          {detail && (
            <>
              {detail.length > 100 ? (
                <>
                  <p className="text-xs text-slate-500 mt-1 font-mono leading-relaxed whitespace-pre-wrap break-words">
                    {expanded ? detail : detail.slice(0, 100) + '\u2026'}
                  </p>
                  <button
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs text-blue-500 hover:text-blue-700 mt-0.5 font-medium"
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-500 mt-1 font-mono leading-relaxed whitespace-pre-wrap break-words">
                  {detail}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ThinkingBlock ────────────────────────────────────────────────────
export default function ThinkingBlock({
  steps, activeStep, thoughts, agent, status, hasTokens,
  thinkingText, thinkingLog, toolCalls,
}) {
  const isStreaming = status === 'streaming'
  const isDone      = status === 'complete' || status === 'error'
  const [open, setOpen] = useState(false)

  const timeline    = buildTimeline(steps, thoughts, thinkingLog ?? [], toolCalls ?? [])
  const hasContent  = timeline.length > 0 || !!activeStep || !!thinkingText
  if (!hasContent) return null

  const agentName = agent?.workerName ?? 'Agent'

  // Live activity preview for collapsed header
  const livePreview = (() => {
    if (!isStreaming) return null
    if (thinkingText?.text) {
      const label = NODE_LABELS[thinkingText.node] ?? thinkingText.node
      const snippet = thinkingText.text.replace(/\n/g, ' ').slice(-60)
      return `${label}: ${snippet}`
    }
    if (activeStep) return activeStep
    return 'starting up\u2026'
  })()

  const headerText = isStreaming
    ? `${agentName} is working`
    : `${agentName} worked through ${steps.length} step${steps.length !== 1 ? 's' : ''}`

  const lastPass = [...thoughts].reverse().find((t) => t.verdict === 'pass')
  const activeToolCount = Math.max(0,
    (toolCalls ?? []).filter((tc) => tc.action === 'start').length
    - (toolCalls ?? []).filter((tc) => tc.action === 'end').length
  )

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden backdrop-blur-sm">
      {/* ── Collapsed header ──────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-100/80 transition-colors text-left"
        aria-expanded={open}
        aria-controls="thinking-timeline"
      >
        {isStreaming
          ? <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        }

        <span className="text-sm font-medium text-slate-700 shrink-0">{headerText}</span>

        {isStreaming && livePreview && (
          <span className="flex-1 text-xs text-slate-400 truncate min-w-0 ml-1">
            \u00B7 {livePreview}
          </span>
        )}
        {!isStreaming && <span className="flex-1" />}

        {isStreaming && activeToolCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium shrink-0 animate-pulse">
            {activeToolCount} tool{activeToolCount !== 1 ? 's' : ''}
          </span>
        )}

        {steps.length > 0 && (
          <span className="text-xs text-slate-400 shrink-0">
            {steps.length} step{steps.length !== 1 ? 's' : ''}
          </span>
        )}

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

      {/* ── Expanded timeline ─────────────────────────────────────────── */}
      <div
        id="thinking-timeline"
        className={`border-t border-slate-200 px-4 py-3 space-y-2.5 max-h-96 overflow-y-auto transition-all duration-200
          ${open ? 'opacity-100' : 'hidden opacity-0'}`}
        role="region"
        aria-label="Agent activity timeline"
      >
        {timeline.map((item) => {
          if (item._type === 'step') {
            return (
              <div key={item.id} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-sm text-slate-600">{item.message}</span>
              </div>
            )
          }
          if (item._type === 'thought') {
            return <ThoughtBubble key={item.id} thought={item} />
          }
          if (item._type === 'llm') {
            return <LLMThinkingBubble key={item.id} node={item.node} text={item.text} />
          }
          if (item._type === 'tool') {
            return (
              <ToolCallBubble
                key={item.id}
                action={item.action}
                tool={item.tool}
                node={item.node}
                inputPreview={item.inputPreview}
                outputPreview={item.outputPreview}
              />
            )
          }
          return null
        })}

        {thinkingText && (
          <LLMThinkingBubble node={thinkingText.node} text={thinkingText.text} isLive />
        )}

        {activeStep && (
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
            <span className="text-sm font-medium text-blue-700">{activeStep}</span>
          </div>
        )}
      </div>
    </div>
  )
}
