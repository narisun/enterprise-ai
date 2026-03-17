/**
 * ExecutionRail — Phase 3, left panel.
 *
 * Shows a live vertical timeline of pipeline steps as they arrive via SSE.
 * - Completed steps  → green checkmark
 * - Active step      → animated blue spinner + pulsing background
 * - Pending steps    → grey placeholder (from agent.progressSteps)
 * - Error            → red X
 *
 * Props:
 *   steps       — array of {id, message} — completed steps from useAgentStream
 *   activeStep  — string | null           — the step currently executing
 *   status      — 'streaming' | 'complete' | 'error' | 'idle'
 *   agent       — agent config object
 */

import { CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react'

function StepRow({ icon, message, subtext, className = '' }) {
  return (
    <div className={`flex items-start gap-3 animate-slide-in ${className}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 leading-snug">{message}</p>
        {subtext && <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>}
      </div>
    </div>
  )
}

export default function ExecutionRail({ steps, activeStep, status, agent }) {
  const doneSteps    = steps
  const pendingSteps = agent?.progressSteps?.slice(doneSteps.length + (activeStep ? 1 : 0)) ?? []

  return (
    <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          {status === 'streaming' && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse-fast" />
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Running</span>
            </span>
          )}
          {status === 'complete' && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Complete</span>
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-xs font-semibold text-red-600 uppercase tracking-wider">Error</span>
            </span>
          )}
          {status === 'idle' && (
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ready</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {agent?.name ?? 'Agent'} Pipeline
        </p>
      </div>

      {/* Timeline */}
      <div className="flex-1 px-5 py-5">
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[9px] top-3 bottom-3 w-px bg-slate-200 -z-0" />

          <div className="space-y-4 relative z-10">

            {/* ── Completed steps ─────────────────────────────────────── */}
            {doneSteps.map((step) => (
              <StepRow
                key={step.id}
                icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                message={step.message}
              />
            ))}

            {/* ── Active step (spinner) ────────────────────────────────── */}
            {activeStep && (
              <div className="flex items-start gap-3 rounded-xl bg-blue-50 border border-blue-100 p-3 -mx-1 animate-fade-in">
                <Loader2 className="w-5 h-5 text-blue-500 shrink-0 mt-0.5 animate-spin" />
                <div>
                  <p className="text-sm font-semibold text-blue-800 leading-snug">{activeStep}</p>
                  <p className="text-xs text-blue-500 mt-0.5 animate-pulse">Processing…</p>
                </div>
              </div>
            )}

            {/* ── Error indicator ──────────────────────────────────────── */}
            {status === 'error' && (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-100 p-3 -mx-1 animate-fade-in">
                <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-red-700">Agent encountered an error</p>
              </div>
            )}

            {/* ── Pending steps (ghost) ────────────────────────────────── */}
            {status === 'streaming' && pendingSteps.map((msg, i) => (
              <div key={`pending-${i}`} className="flex items-start gap-3 opacity-35">
                <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-400 leading-snug">{msg}</p>
              </div>
            ))}

            {/* ── All done indicator ───────────────────────────────────── */}
            {status === 'complete' && (
              <div className="flex items-start gap-3 animate-fade-in">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Brief ready</p>
                  <p className="text-xs text-emerald-600 mt-0.5">All pipeline stages complete</p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Data sources footer */}
      {agent?.dataSources && (
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2">Data sources</p>
          <div className="space-y-1">
            {agent.dataSources.map((src) => (
              <div key={src.label} className="flex items-center gap-2 text-xs text-slate-500">
                <span>{src.icon}</span>
                {src.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
