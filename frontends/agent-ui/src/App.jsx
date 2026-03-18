/**
 * App.jsx — Root component and state machine.
 *
 * Phases:
 *   select      → AgentSelector: pick an agent
 *   configure   → PromptBuilder: fill in template variables
 *   run/refine  → ExecutionRail + OutputCanvas: live execution + output
 *
 * The session ID is stable for the lifetime of the browser tab, enabling
 * LangGraph's MemorySaver to provide multi-turn continuity on the backend.
 */

import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { LayoutGrid, ChevronRight, User, Zap } from 'lucide-react'

import AgentSelector  from './components/AgentSelector.jsx'
import PromptBuilder  from './components/PromptBuilder.jsx'
import ExecutionRail  from './components/ExecutionRail.jsx'
import OutputCanvas   from './components/OutputCanvas.jsx'
import { useAgentStream } from './hooks/useAgentStream.js'
import { AGENTS } from './config/agents.js'

const PHASES = { SELECT: 'select', CONFIGURE: 'configure', EXECUTE: 'execute' }

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function Breadcrumb({ phase, agent, onSelectClick, onAgentClick }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500 select-none">
      <button
        onClick={onSelectClick}
        className="hover:text-slate-800 transition-colors flex items-center gap-1"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Digital Workers
      </button>
      {phase !== PHASES.SELECT && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <button
            onClick={onAgentClick}
            className={`transition-colors ${phase === PHASES.CONFIGURE ? 'text-slate-800 font-medium' : 'hover:text-slate-800'}`}
          >
            {agent?.workerName ?? '…'}
          </button>
        </>
      )}
      {phase === PHASES.EXECUTE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">Results</span>
        </>
      )}
    </nav>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ agent, rmId, onRmIdChange, sessionId, onNewSession, phase }) {
  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-white flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">Digital Workers</p>
            <p className="text-xs text-slate-400 leading-tight">Enterprise AI Platform</p>
          </div>
        </div>
      </div>

      {/* Active worker info */}
      <div className="px-5 py-4 flex-1 overflow-y-auto space-y-5">
        {agent ? (
          <>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Working with</p>
              <div className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-xl shrink-0">
                  {agent.icon}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-base leading-tight">{agent.workerName}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">{agent.workerRole}</p>
                </div>
              </div>
            </div>

            {agent.dataSources?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Data Sources</p>
                <div className="space-y-1.5">
                  {agent.dataSources.map((src) => (
                    <div key={src.label} className="flex items-center gap-2 text-xs text-slate-300">
                      <span>{src.icon}</span>
                      {src.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Your Team</p>
            <div className="space-y-1.5">
              {AGENTS.filter((a) => !a.comingSoon).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs text-slate-300">
                  <span>{a.icon}</span>
                  <span className="font-medium">{a.workerName}</span>
                  <span className="text-slate-500">· Active</span>
                </div>
              ))}
              {AGENTS.filter((a) => a.comingSoon).slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs text-slate-600">
                  <span>{a.icon}</span>
                  <span>{a.workerName}</span>
                  <span>· Soon</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RM Identity + session controls */}
      <div className="px-5 py-4 border-t border-slate-700 space-y-3">
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider font-medium block mb-1.5">
            <User className="w-3 h-3 inline mr-1 -mt-0.5" />Your Name
          </label>
          <input
            type="text"
            value={rmId}
            onChange={(e) => onRmIdChange(e.target.value)}
            placeholder="Your name"
            className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>
        <button
          onClick={onNewSession}
          className="w-full text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500
            rounded-lg py-2 transition-colors"
        >
          ↺ New Session
        </button>
        <p className="text-xs text-slate-600 text-center truncate" title={sessionId}>
          Session {sessionId.slice(0, 8)}…
        </p>
      </div>
    </aside>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,         setPhase]         = useState(PHASES.SELECT)
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [rmId,          setRmId]          = useState('RM')
  const [sessionId,     setSessionId]     = useState(() => uuidv4())

  const { steps, activeStep, thoughts, output, clientName, status, error, run, reset } = useAgentStream()

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAgentSelect = useCallback((agent) => {
    setSelectedAgent(agent)
    setPhase(PHASES.CONFIGURE)
  }, [])

  const handlePromptSubmit = useCallback(async (prompt) => {
    setPhase(PHASES.EXECUTE)
    await run({
      endpoint: selectedAgent.endpoint,
      body: selectedAgent.requestShape(prompt, rmId, sessionId),
    })
  }, [selectedAgent, rmId, sessionId, run])

  // Follow-up refinement — keeps same session so backend has context
  const handleRefine = useCallback(async (prompt) => {
    await run({
      endpoint: selectedAgent.endpoint,
      body: selectedAgent.requestShape(prompt, rmId, sessionId),
    })
  }, [selectedAgent, rmId, sessionId, run])

  const handleNewSession = useCallback(() => {
    reset()
    setPhase(PHASES.SELECT)
    setSelectedAgent(null)
    setSessionId(uuidv4())
  }, [reset])

  const goToSelect   = useCallback(() => { reset(); setPhase(PHASES.SELECT);    setSelectedAgent(null) }, [reset])
  const goToConfigure = useCallback(() => { reset(); setPhase(PHASES.CONFIGURE) }, [reset])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">

      {/* ── Top header bar ─────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-10">
        <Breadcrumb
          phase={phase}
          agent={selectedAgent}
          onSelectClick={goToSelect}
          onAgentClick={goToConfigure}
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${status === 'streaming' ? 'bg-blue-500 animate-pulse' : 'bg-emerald-400'}`} />
            <span className="text-xs text-slate-500">
              {status === 'streaming' ? 'Running' : status === 'error' ? 'Error' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Sidebar */}
        <Sidebar
          agent={selectedAgent}
          rmId={rmId}
          onRmIdChange={setRmId}
          sessionId={sessionId}
          onNewSession={handleNewSession}
          phase={phase}
        />

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Phase: SELECT — Staff Directory */}
          {phase === PHASES.SELECT && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Your Digital Team</h1>
                <p className="text-slate-500 mt-1">
                  AI workers embedded in your workflows — each with a defined role, data access, and specialist skills.
                </p>
              </div>
              <AgentSelector onSelect={handleAgentSelect} />
            </div>
          )}

          {/* Phase: CONFIGURE */}
          {phase === PHASES.CONFIGURE && selectedAgent && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-2xl">{selectedAgent.icon}</span>
                  <h1 className="text-2xl font-bold text-slate-900">{selectedAgent.workerName}</h1>
                </div>
                <p className="text-sm font-semibold text-slate-500">{selectedAgent.workerRole}</p>
                <p className="text-slate-500 mt-2 text-sm">{selectedAgent.description}</p>
              </div>
              <PromptBuilder agent={selectedAgent} onSubmit={handlePromptSubmit} />
            </div>
          )}

          {/* Phase: EXECUTE — split: ExecutionRail | OutputCanvas */}
          {phase === PHASES.EXECUTE && (
            <div className="flex-1 flex overflow-hidden">
              <ExecutionRail
                steps={steps}
                activeStep={activeStep}
                status={status}
                agent={selectedAgent}
              />
              <OutputCanvas
                output={output}
                clientName={clientName}
                status={status}
                error={error}
                onRefine={handleRefine}
                agent={selectedAgent}
                steps={steps}
                activeStep={activeStep}
                thoughts={thoughts}
              />
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
