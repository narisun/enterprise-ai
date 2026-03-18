/**
 * App.jsx — Root component and state machine.
 *
 * Phases:
 *   select      → AgentSelector: pick an agent
 *   configure   → PromptBuilder: fill in template variables
 *   run/refine  → OutputCanvas: full-width canvas with inline ThinkingBlock
 *
 * ── Session management ────────────────────────────────────────────────────
 * Session IDs are managed by useSession(), which persists them in
 * sessionStorage so multi-turn flows survive hot-reloads during development.
 *
 * ── API dispatch ──────────────────────────────────────────────────────────
 * Endpoint URLs and request shapes are looked up from agentClients.js via
 * getAgentClient(agent.id).  App.jsx knows nothing about backend routes or
 * field names — those concerns live entirely in the API layer.
 */

import { useState, useCallback, useEffect } from 'react'
import { LayoutGrid, ChevronRight, User, Zap, HelpCircle, Settings, FlaskConical } from 'lucide-react'

import AgentSelector from './components/AgentSelector.jsx'
import PromptBuilder from './components/PromptBuilder.jsx'
import OutputCanvas  from './components/OutputCanvas.jsx'
import { useAgentStream }                    from './hooks/useAgentStream.js'
import { useSession }                        from './hooks/useSession.js'
import { getAgentClient }                    from './api/agentClients.js'
import { fetchPersonaToken, fetchPersonas }  from './api/apiClient.js'
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
        Meridian
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

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cfg = {
    streaming: { dot: 'bg-blue-500 animate-pulse',   badge: 'bg-blue-50 text-blue-700 border-blue-200',   label: 'Running'  },
    complete:  { dot: 'bg-emerald-500',               badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Ready' },
    error:     { dot: 'bg-red-500',                   badge: 'bg-red-50 text-red-700 border-red-200',       label: 'Error'    },
    idle:      { dot: 'bg-slate-400',                 badge: 'bg-slate-50 text-slate-500 border-slate-200', label: 'Idle'     },
  }[status] ?? { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-500 border-slate-200', label: 'Idle' }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ── Persona Selector (dev / local only) ───────────────────────────────────────
//
// Renders a compact dropdown in the sidebar that lets developers switch the
// test persona used for brief requests.  When a persona is selected a signed
// JWT is fetched from POST /auth/token and stored in the parent's state; it
// is then injected into every subsequent /brief request body so the MCP
// servers see the correct X-Agent-Context on their per-request bridges.
//
// The component is only shown when the backend confirms that at least one
// persona is available (i.e. ENVIRONMENT=local|dev).  In production the
// /auth/personas endpoint returns 403 and the component stays hidden.

const PERSONA_BADGE_COLOURS = {
  manager:    'bg-purple-900/50 text-purple-300 border-purple-700',
  senior_rm:  'bg-blue-900/50   text-blue-300   border-blue-700',
  rm:         'bg-teal-900/50   text-teal-300   border-teal-700',
  readonly:   'bg-slate-700/50  text-slate-400  border-slate-600',
}

function PersonaSelector({ onPersonaChange }) {
  const [personas,         setPersonas]         = useState([])
  const [selectedPersona,  setSelectedPersona]  = useState('manager')
  const [status,           setStatus]           = useState('idle') // idle | loading | ok | error

  // Load persona list once on mount — skip silently in production (403)
  useEffect(() => {
    fetchPersonas()
      .then(setPersonas)
      .catch(() => { /* 403 in production — stay hidden */ })
  }, [])

  const handleChange = useCallback(async (e) => {
    const persona = e.target.value
    setSelectedPersona(persona)
    setStatus('loading')
    try {
      const { access_token } = await fetchPersonaToken(persona)
      onPersonaChange(persona, access_token)
      setStatus('ok')
    } catch {
      onPersonaChange(null, null)
      setStatus('error')
    }
  }, [onPersonaChange])

  // Activate the default persona (manager) on first render once personas load
  useEffect(() => {
    if (personas.length === 0) return
    // Auto-select manager to unblock end-to-end testing immediately
    fetchPersonaToken('manager')
      .then(({ access_token }) => onPersonaChange('manager', access_token))
      .catch(() => onPersonaChange(null, null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personas.length])

  if (personas.length === 0) return null   // hidden in production

  const info = personas.find((p) => p.name === selectedPersona)

  return (
    <div>
      <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1 flex items-center gap-1.5">
        <FlaskConical className="w-3 h-3" />
        Test Persona
      </p>
      <div className="bg-slate-800/70 rounded-xl p-3 space-y-2">
        <div className="relative">
          <select
            value={selectedPersona}
            onChange={handleChange}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 pr-6
              border border-slate-600 focus:border-blue-500 outline-none appearance-none cursor-pointer"
          >
            {personas.map((p) => (
              <option key={p.name} value={p.name}>{p.name} — {p.role}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
        </div>

        {info && (
          <p className="text-xs text-slate-400 leading-snug">{info.description}</p>
        )}

        <div className="flex items-center gap-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded border font-mono
            ${PERSONA_BADGE_COLOURS[selectedPersona] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
            {info?.role ?? selectedPersona}
          </span>
          {status === 'loading' && (
            <span className="text-xs text-slate-500 animate-pulse">Signing JWT…</span>
          )}
          {status === 'ok' && (
            <span className="text-xs text-emerald-500">✓ JWT ready</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-red-400">Token error</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ agent, rmId, onRmIdChange, sessionId, onNewSession, onPersonaChange }) {
  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-white flex flex-col h-full">

      {/* ── Logo — sits at the same height as the content sub-header ─────── */}
      <div className="px-5 h-14 flex items-center border-b border-slate-700/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight tracking-tight">Meridian</p>
            <p className="text-xs text-slate-400 leading-tight">Enterprise Intelligence</p>
          </div>
        </div>
      </div>

      {/* ── Active worker / team roster ───────────────────────────────────── */}
      <div className="px-4 py-4 flex-1 overflow-y-auto space-y-5">
        {agent ? (
          <>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1">Working with</p>
              <div className="bg-slate-800/70 rounded-xl p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-xl shrink-0">
                  {agent.icon}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm leading-tight">{agent.workerName}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">{agent.workerRole}</p>
                </div>
              </div>
            </div>

            {agent.dataSources?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1">Data Sources</p>
                <div className="space-y-1">
                  {agent.dataSources.map((src) => (
                    <div key={src.label} className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800/50 transition-colors">
                      <span className="text-sm">{src.icon}</span>
                      <span>{src.label}</span>
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Connected" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1">Intelligence Team</p>
            <div className="space-y-1">
              {AGENTS.filter((a) => !a.comingSoon).map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg text-xs text-slate-300">
                  <span>{a.icon}</span>
                  <span className="font-medium">{a.workerName}</span>
                  <span className="ml-auto text-emerald-500 font-medium">Active</span>
                </div>
              ))}
              {AGENTS.filter((a) => a.comingSoon).slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 px-1 py-1.5 text-xs text-slate-600">
                  <span>{a.icon}</span>
                  <span>{a.workerName}</span>
                  <span className="ml-auto">Soon</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Test Persona (dev/local only — hidden in prod) ────────────────── */}
      <div className="px-4 pb-2">
        <PersonaSelector onPersonaChange={onPersonaChange} />
      </div>

      {/* ── User identity ─────────────────────────────────────────────────── */}
      <div className="px-4 py-4 border-t border-slate-700/60 space-y-3">
        {/* Editable RM name displayed as an identity chip */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-white" />
          </div>
          <input
            type="text"
            value={rmId}
            onChange={(e) => onRmIdChange(e.target.value)}
            placeholder="Your name"
            className="flex-1 bg-transparent text-white text-xs font-medium outline-none
              placeholder-slate-500 border-b border-transparent focus:border-slate-600 transition-colors pb-0.5"
          />
        </div>
        <button
          onClick={onNewSession}
          className="w-full text-xs text-slate-400 hover:text-white border border-slate-700/60 hover:border-slate-600
            rounded-lg py-1.5 transition-colors"
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

  // Test persona state — null in production, auto-set to 'manager' in dev
  const [personaName, setPersonaName] = useState(null)
  const [personaJwt,  setPersonaJwt]  = useState(null)

  const handlePersonaChange = useCallback((name, jwt) => {
    setPersonaName(name)
    setPersonaJwt(jwt)
  }, [])

  // Session ID is now managed by a dedicated hook — persisted in sessionStorage
  // so multi-turn flows survive Vite hot-reloads during development.
  const { sessionId, newSession } = useSession()

  const { steps, activeStep, thoughts, streamingText, output, clientName, status, error, run, reset } = useAgentStream()

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAgentSelect = useCallback((agent) => {
    setSelectedAgent(agent)
    setPhase(PHASES.CONFIGURE)
  }, [])

  const handlePromptSubmit = useCallback(async (prompt) => {
    setPhase(PHASES.EXECUTE)
    // Endpoint and request shape are looked up from the API layer — App.jsx
    // does not hardcode routes or field names.
    // When a persona JWT is active (dev/local only) it is forwarded so the
    // backend uses per-request MCP bridges with that persona's context.
    const client = getAgentClient(selectedAgent.id)
    await run({
      endpoint: client.endpoint,
      body:     client.buildRequest(prompt, rmId, sessionId, personaJwt),
    })
  }, [selectedAgent, rmId, sessionId, personaJwt, run])

  // Follow-up refinement — keeps the same session so the backend has context
  const handleRefine = useCallback(async (prompt) => {
    const client = getAgentClient(selectedAgent.id)
    await run({
      endpoint: client.endpoint,
      body:     client.buildRequest(prompt, rmId, sessionId, personaJwt),
    })
  }, [selectedAgent, rmId, sessionId, personaJwt, run])

  const handleNewSession = useCallback(() => {
    reset()
    newSession()
    setPhase(PHASES.SELECT)
    setSelectedAgent(null)
  }, [reset, newSession])

  const goToSelect    = useCallback(() => { reset(); setPhase(PHASES.SELECT);    setSelectedAgent(null) }, [reset])
  const goToConfigure = useCallback(() => { reset(); setPhase(PHASES.CONFIGURE) }, [reset])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    // Sidebar spans the full viewport height; content column stacks sub-header + main
    <div className="h-screen flex overflow-hidden bg-slate-50">

      {/* ── Sidebar — full height ────────────────────────────────────────── */}
      <Sidebar
        agent={selectedAgent}
        rmId={rmId}
        onRmIdChange={setRmId}
        sessionId={sessionId}
        onNewSession={handleNewSession}
        onPersonaChange={handlePersonaChange}
      />

      {/* ── Content column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Sub-header — sits flush with sidebar logo, same h-14 height */}
        <header className="shrink-0 h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10">
          <Breadcrumb
            phase={phase}
            agent={selectedAgent}
            onSelectClick={goToSelect}
            onAgentClick={goToConfigure}
          />
          <div className="flex items-center gap-2">
            <StatusPill status={status} />
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <button
              title="Help & documentation"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              title="Settings"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Phase: SELECT — Staff Directory */}
          {phase === PHASES.SELECT && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Your Intelligence Team</h1>
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

          {/* Phase: EXECUTE — full-width canvas with inline ThinkingBlock */}
          {phase === PHASES.EXECUTE && (
            <OutputCanvas
              output={output}
              streamingText={streamingText}
              clientName={clientName}
              status={status}
              error={error}
              onRefine={handleRefine}
              agent={selectedAgent}
              steps={steps}
              activeStep={activeStep}
              thoughts={thoughts}
            />
          )}

        </main>
      </div>
    </div>
  )
}
