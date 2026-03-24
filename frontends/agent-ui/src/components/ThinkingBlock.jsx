/**
 * ThinkingBlock — Professional streaming activity display.
 *
 * Inspired by Claude, ChatGPT, and Perplexity streaming patterns:
 *
 *   • AUTO-EXPANDS during streaming so users see live progress
 *   • Shows clean, human-readable step labels — never raw JSON
 *   • Tool calls displayed as friendly action cards with status icons
 *   • Collapses automatically when output arrives
 *   • User can toggle open/closed at any time
 *   • Smooth animations on all state transitions
 *
 * Extracted from OutputCanvas.jsx for testability and reuse.
 */

import { useState, useEffect, useRef } from 'react'
import {
  CheckCircle2, Loader2, ChevronDown, ChevronRight,
  Search, Database, Newspaper, Brain, FileText,
  BarChart3, Shield, Sparkles, Zap, Globe,
} from 'lucide-react'
import { NODE_LABELS, getToolLabel } from '../lib/nodeLabels.js'

// ── Icon map for tool categories ────────────────────────────────────────────
const TOOL_ICONS = {
  get_salesforce_summary:  Database,
  get_crm_relationships:   Database,
  get_crm_activities:      Database,
  get_crm_opportunities:   Database,
  get_payment_summary:     BarChart3,
  get_payment_details:     BarChart3,
  search_company_news:     Newspaper,
  get_portfolio_positions: BarChart3,
  get_market_signals:      Globe,
  get_risk_metrics:        Shield,
}

function getToolIcon(toolName) {
  return TOOL_ICONS[toolName] ?? Search
}

// ── Step icon mapping ─────────────────────────────────────────────────────
function getStepIcon(message) {
  const m = (message ?? '').toLowerCase()
  if (m.includes('persona') || m.includes('running as')) return Sparkles
  if (m.includes('identifying') || m.includes('client') || m.includes('intent')) return Search
  if (m.includes('planning') || m.includes('retrieval') || m.includes('routing')) return Brain
  if (m.includes('crm') || m.includes('salesforce')) return Database
  if (m.includes('payment') || m.includes('analys')) return BarChart3
  if (m.includes('news') || m.includes('search')) return Newspaper
  if (m.includes('synthe') || m.includes('generat') || m.includes('format')) return FileText
  if (m.includes('evaluat') || m.includes('fact')) return Shield
  return Zap
}

// ── Completed step row ──────────────────────────────────────────────────────
function StepRow({ message, isLast }) {
  const Icon = getStepIcon(message)
  return (
    <div className="flex items-center gap-3 py-1.5 animate-fade-in">
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        </div>
        {!isLast && <div className="w-px h-3 bg-slate-200 mt-1" />}
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-sm text-slate-600">{message}</span>
      </div>
    </div>
  )
}

// ── Active step row (currently in progress) ─────────────────────────────────
function ActiveStepRow({ message }) {
  const Icon = getStepIcon(message)
  return (
    <div className="flex items-center gap-3 py-1.5 animate-fade-in">
      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
        <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        <span className="text-sm font-medium text-blue-700">{message}</span>
      </div>
    </div>
  )
}

// ── Tool call card — clean, no raw JSON ─────────────────────────────────────
function ToolCallCard({ tool, action, node }) {
  const isDone = action === 'end'
  const ToolIcon = getToolIcon(tool)
  const label = getToolLabel(tool)
  const nodeLabel = NODE_LABELS[node] ?? node

  return (
    <div className={`flex items-center gap-3 py-1 px-3 rounded-lg ml-8 animate-fade-in ${
      isDone ? 'bg-emerald-50/80' : 'bg-blue-50/80'
    }`}>
      <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
        isDone ? 'bg-emerald-100' : 'bg-blue-100'
      }`}>
        {isDone
          ? <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          : <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
        }
      </div>
      <ToolIcon className={`w-3.5 h-3.5 shrink-0 ${isDone ? 'text-emerald-500' : 'text-blue-500'}`} />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`text-xs font-medium ${isDone ? 'text-emerald-700' : 'text-blue-700'}`}>
          {label}
        </span>
        <span className="text-xs text-slate-400">{nodeLabel}</span>
        {isDone && (
          <span className="text-xs text-emerald-600 font-medium ml-auto">done</span>
        )}
      </div>
    </div>
  )
}

// ── Evaluator thought bubble ────────────────────────────────────────────────
function ThoughtBubble({ thought }) {
  const isPass = thought.verdict === 'pass'
  return (
    <div className={`flex items-center gap-3 py-1 px-3 rounded-lg ml-8 animate-fade-in ${
      isPass ? 'bg-emerald-50/80' : 'bg-violet-50/80'
    }`}>
      <Shield className={`w-3.5 h-3.5 shrink-0 ${isPass ? 'text-emerald-500' : 'text-violet-500'}`} />
      <span className={`text-xs font-medium ${isPass ? 'text-emerald-700' : 'text-violet-700'}`}>
        {thought.message}
      </span>
      {thought.score != null && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ml-auto ${
          isPass ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
        }`}>
          {(thought.score * 100).toFixed(0)}%
        </span>
      )}
    </div>
  )
}

// ── Main ThinkingBlock ──────────────────────────────────────────────────────
export default function ThinkingBlock({
  steps, activeStep, thoughts, agent, status, hasTokens,
  thinkingText, thinkingLog, toolCalls,
}) {
  const isStreaming = status === 'streaming'
  const isDone = status === 'complete' || status === 'error'

  // Auto-expand during streaming, auto-collapse when output arrives
  const [userToggled, setUserToggled] = useState(false)
  const [open, setOpen] = useState(false)
  const prevStatus = useRef(status)

  useEffect(() => {
    if (prevStatus.current !== status) {
      if (status === 'streaming' && !userToggled) {
        setOpen(true)
      }
      if ((status === 'complete' || status === 'error') && !userToggled) {
        setOpen(false)
      }
      prevStatus.current = status
    }
  }, [status, userToggled])

  const handleToggle = () => {
    setUserToggled(true)
    setOpen((v) => !v)
  }

  const hasContent = steps.length > 0 || !!activeStep || (toolCalls ?? []).length > 0 || thoughts.length > 0
  if (!hasContent) return null

  const agentName = agent?.workerName ?? 'Agent'
  const totalSteps = steps.length + (activeStep ? 1 : 0)
  const completedTools = (toolCalls ?? []).filter((tc) => tc.action === 'end').length
  const activeToolCount = Math.max(0,
    (toolCalls ?? []).filter((tc) => tc.action === 'start').length - completedTools
  )

  // Build the header text
  const headerText = isStreaming
    ? `${agentName} is working`
    : `${agentName} completed ${steps.length} step${steps.length !== 1 ? 's' : ''}`

  // Build a short live status for the header
  const liveStatus = (() => {
    if (!isStreaming) return null
    if (activeToolCount > 0) {
      const lastActiveTool = [...(toolCalls ?? [])].reverse().find((tc) => tc.action === 'start')
      if (lastActiveTool) return getToolLabel(lastActiveTool.tool)
    }
    if (activeStep) return activeStep
    return null
  })()

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
        aria-expanded={open}
        aria-controls="thinking-timeline"
      >
        {isStreaming
          ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        }
        <span className="text-sm font-semibold text-slate-800">{headerText}</span>

        {isStreaming && liveStatus && (
          <span className="text-xs text-slate-400 truncate min-w-0 flex-1">
            — {liveStatus}
          </span>
        )}
        {!isStreaming && <span className="flex-1" />}

        {/* Badges */}
        {completedTools > 0 && !isStreaming && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium shrink-0">
            {completedTools} source{completedTools !== 1 ? 's' : ''}
          </span>
        )}

        {open
          ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        }
      </button>

      {/* ── Expanded content ─────────────────────────────────────────────── */}
      {open && (
        <div
          id="thinking-timeline"
          className="border-t border-slate-100 px-4 py-3 space-y-0.5 max-h-[28rem] overflow-y-auto animate-slide-down"
          role="region"
          aria-label="Agent activity timeline"
        >
          {/* Completed steps */}
          {steps.map((step, i) => (
            <div key={step.id}>
              <StepRow message={step.message} isLast={!activeStep && i === steps.length - 1 && thoughts.length === 0} />
              {/* Show tool calls that happened during/after this step */}
              {(toolCalls ?? [])
                .filter((tc) => {
                  const nextStep = steps[i + 1]
                  return tc.ts >= step.ts && (!nextStep || tc.ts < nextStep.ts)
                })
                .filter((tc) => tc.action === 'end') // Only show completed tools
                .map((tc) => (
                  <ToolCallCard key={tc.id} tool={tc.tool} action={tc.action} node={tc.node} />
                ))
              }
            </div>
          ))}

          {/* Active step */}
          {activeStep && (
            <>
              <ActiveStepRow message={activeStep} />
              {/* Show in-flight tool calls under active step */}
              {(toolCalls ?? [])
                .filter((tc) => {
                  const lastStepTs = steps.length > 0 ? steps[steps.length - 1].ts : 0
                  return tc.ts >= lastStepTs
                })
                .map((tc) => (
                  <ToolCallCard key={tc.id} tool={tc.tool} action={tc.action} node={tc.node} />
                ))
              }
            </>
          )}

          {/* Evaluator thoughts */}
          {thoughts.map((t) => (
            <ThoughtBubble key={t.id} thought={t} />
          ))}
        </div>
      )}
    </div>
  )
}
