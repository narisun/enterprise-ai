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

import { useState, useCallback, useEffect, useRef } from 'react'
import { LayoutGrid, ChevronRight, User, Zap, HelpCircle, Settings, FlaskConical } from 'lucide-react'

import AgentSelector    from './components/AgentSelector.jsx'
import PromptBuilder    from './components/PromptBuilder.jsx'
import OutputCanvas     from './components/OutputCanvas.jsx'
import DataSourceDetail from './components/DataSourceDetail.jsx'
import HelpGuide        from './components/HelpGuide.jsx'
import SettingsPanel    from './components/SettingsPanel.jsx'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './components/SettingsPanel.jsx'
import UserProfile      from './components/UserProfile.jsx'
import { useAgentStream }                    from './hooks/useAgentStream.js'
import { useSession }                        from './hooks/useSession.js'
import { getAgentClient }                    from './api/agentClients.js'
import { fetchPersonaToken, fetchPersonas }  from './api/apiClient.js'
import { AGENTS } from './config/agents.js'
import { getDataSource } from './config/dataSources.js'

const PHASES = {
  SELECT:      'select',
  CONFIGURE:   'configure',
  EXECUTE:     'execute',
  DATA_SOURCE: 'data-source',
  HELP:        'help',
  SETTINGS:    'settings',
  PROFILE:     'profile',
}

// ── URL ↔ phase helpers ───────────────────────────────────────────────────────
// These keep the address bar in sync with the phase state so the URL is
// meaningful and bookmarkable. Vite's dev server already serves index.html
// for any path (historyApiFallback is on by default), so deep links work
// without additional server config in development.

function phaseToPath(phase, extra = {}) {
  switch (phase) {
    case PHASES.CONFIGURE:   return `/agent/${extra.selectedAgentId ?? ''}`
    case PHASES.EXECUTE:     return `/agent/${extra.selectedAgentId ?? ''}/run`
    case PHASES.DATA_SOURCE: return `/data/${extra.selectedSource ?? ''}`
    case PHASES.HELP:        return '/help'
    case PHASES.SETTINGS:    return '/settings'
    case PHASES.PROFILE:     return '/profile'
    default:                 return '/'
  }
}

// Parse the current pathname back into a partial history state object so the
// app can restore to the correct phase on a hard refresh or deep-link visit.
function pathToState(pathname) {
  const parts = pathname.replace(/^\//, '').split('/').filter(Boolean)
  if (!parts.length)                              return { phase: PHASES.SELECT }
  if (parts[0] === 'agent' && parts[1]) {
    if (parts[2] === 'run')                       return { phase: PHASES.EXECUTE,     selectedAgentId: parts[1] }
                                                  return { phase: PHASES.CONFIGURE,   selectedAgentId: parts[1] }
  }
  if (parts[0] === 'data'     && parts[1])        return { phase: PHASES.DATA_SOURCE, selectedSource:  parts[1] }
  if (parts[0] === 'help')                        return { phase: PHASES.HELP }
  if (parts[0] === 'settings')                    return { phase: PHASES.SETTINGS }
  if (parts[0] === 'profile')                     return { phase: PHASES.PROFILE }
  return { phase: PHASES.SELECT }
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function Breadcrumb({ phase, agent, selectedSourceId, onSelectClick, onAgentClick }) {
  const source = selectedSourceId ? getDataSource(selectedSourceId) : null
  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500 select-none">
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); onSelectClick() }}
        className="hover:text-slate-800 transition-colors flex items-center gap-1"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Quantitix
      </a>
      {phase !== PHASES.SELECT && phase !== PHASES.DATA_SOURCE &&
       phase !== PHASES.HELP   && phase !== PHASES.SETTINGS &&
       phase !== PHASES.PROFILE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <a
            href={agent ? `/agent/${agent.id}` : '#'}
            onClick={(e) => { e.preventDefault(); onAgentClick() }}
            className={`transition-colors ${phase === PHASES.CONFIGURE ? 'text-slate-800 font-medium' : 'hover:text-slate-800'}`}
          >
            {agent?.workerName ?? '…'}
          </a>
        </>
      )}
      {phase === PHASES.EXECUTE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">Results</span>
        </>
      )}
      {phase === PHASES.DATA_SOURCE && source && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">
            {source.icon} {source.label}
          </span>
        </>
      )}
      {phase === PHASES.HELP && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">Help</span>
        </>
      )}
      {phase === PHASES.SETTINGS && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">Settings</span>
        </>
      )}
      {phase === PHASES.PROFILE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-800 font-medium">My Profile</span>
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
function Sidebar({ agent, rmId, onRmIdChange, sessionId, onNewSession, onPersonaChange, onDataSourceClick, onLogoClick, onProfileClick }) {
  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-white flex flex-col h-full">

      {/* ── Logo — sits at the same height as the content sub-header ─────── */}
      <div className="px-5 h-14 flex items-center border-b border-slate-700/60 shrink-0">
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); onLogoClick() }}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          title="Go to home"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight tracking-tight">Quantitix</p>
            <p className="text-xs text-slate-400 leading-tight">Agentic AI</p>
          </div>
        </a>
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
                    src.sourceId ? (
                      <a
                        key={src.label}
                        href={`/data/${src.sourceId}`}
                        onClick={(e) => { e.preventDefault(); onDataSourceClick?.(src.sourceId) }}
                        className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800/50 transition-colors group"
                        title={`View ${src.label} details`}
                      >
                        <span className="text-sm">{src.icon}</span>
                        <span className="group-hover:text-white transition-colors">{src.label}</span>
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Connected" />
                      </a>
                    ) : (
                      <div key={src.label} className="flex items-center gap-2.5 px-1 py-1.5 text-xs text-slate-300">
                        <span className="text-sm">{src.icon}</span>
                        <span>{src.label}</span>
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      </div>
                    )
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
        {/* Avatar + name — click to open profile */}
        <a
          href="/profile"
          onClick={(e) => { e.preventDefault(); onProfileClick() }}
          className="w-full flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-slate-800/60 transition-colors group"
          title="View my profile"
        >
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 text-white text-xs font-bold">
            {(rmId || 'RM').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'RM'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white leading-tight truncate group-hover:text-blue-300 transition-colors">
              {rmId || 'Your name'}
            </p>
            <p className="text-[10px] text-slate-500 leading-tight">View profile →</p>
          </div>
        </a>
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
  const [phase,           setPhase]           = useState(PHASES.SELECT)
  const [selectedAgent,   setSelectedAgent]   = useState(null)
  const [rmId,            setRmId]            = useState('RM')
  const [selectedSource,  setSelectedSource]  = useState(null)   // sourceId string
  const [prevPhase,       setPrevPhase]       = useState(null)   // phase to return to from DATA_SOURCE / HELP / SETTINGS

  // ── Persistent settings ──────────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => loadSettings())

  const handleSettingChange = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

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

  const {
    steps, activeStep, thoughts,
    streamingText, output, clientName,
    thinkingText, thinkingLog, toolCalls,
    status, error,
    run, reset,
  } = useAgentStream()

  // ── History API integration ──────────────────────────────────────────────────
  // Every phase transition pushes a history entry so the browser back/forward
  // buttons navigate the phase stack naturally.  The popstate handler restores
  // all state from the serialised history entry — no manual prevPhase tracking
  // is needed for back navigation; we keep prevPhase only for overlay phases
  // that need to know where to return when the user closes them mid-session.

  // Guard so the popstate handler never re-pushes while restoring.
  const isRestoringFromHistory = useRef(false)

  // Low-level push helper — always call this alongside any setPhase().
  // Passes the mapped URL path so the address bar updates on every transition.
  const pushPhase = useCallback((newPhase, extra = {}) => {
    if (isRestoringFromHistory.current) return
    const path = phaseToPath(newPhase, extra)
    window.history.pushState({ phase: newPhase, ...extra }, '', path)
  }, [])

  // On mount: seed history from the current URL so hard-refresh / deep-links
  // restore the correct phase, and ensure the very first back-press has a
  // valid history entry to land on.
  useEffect(() => {
    const initialState = pathToState(window.location.pathname)
    window.history.replaceState(
      { phase: initialState.phase, ...initialState },
      '',
      window.location.pathname,
    )
    // Apply deep-link state to React (SELECT is already the default)
    if (initialState.phase !== PHASES.SELECT) {
      setPhase(initialState.phase)
      if (initialState.selectedAgentId) {
        setSelectedAgent(AGENTS.find((a) => a.id === initialState.selectedAgentId) ?? null)
      }
      if (initialState.selectedSource) {
        setSelectedSource(initialState.selectedSource)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore full app state from a history entry (browser back / forward).
  useEffect(() => {
    const handlePopState = (e) => {
      const s = e.state
      isRestoringFromHistory.current = true

      if (!s) {
        // Popped past the first entry — reset to home
        setPhase(PHASES.SELECT)
        setSelectedAgent(null)
        setSelectedSource(null)
        setPrevPhase(null)
        reset()
        isRestoringFromHistory.current = false
        return
      }

      const restoredPhase = s.phase ?? PHASES.SELECT
      setPhase(restoredPhase)
      setSelectedAgent(
        s.selectedAgentId
          ? AGENTS.find((a) => a.id === s.selectedAgentId) ?? null
          : null
      )
      setSelectedSource(s.selectedSource ?? null)
      setPrevPhase(s.prevPhase ?? null)

      // Clear stream state when leaving EXECUTE via back/forward
      if (restoredPhase !== PHASES.EXECUTE) reset()

      isRestoringFromHistory.current = false
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [reset]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAgentSelect = useCallback((agent) => {
    setSelectedAgent(agent)
    setPhase(PHASES.CONFIGURE)
    pushPhase(PHASES.CONFIGURE, { selectedAgentId: agent.id })
  }, [pushPhase])

  const handlePromptSubmit = useCallback(async (prompt) => {
    setPhase(PHASES.EXECUTE)
    pushPhase(PHASES.EXECUTE, { selectedAgentId: selectedAgent?.id })
    // Endpoint and request shape are looked up from the API layer — App.jsx
    // does not hardcode routes or field names.
    // When a persona JWT is active (dev/local only) it is forwarded so the
    // backend uses per-request MCP bridges with that persona's context.
    const client = getAgentClient(selectedAgent.id)
    await run({
      endpoint: client.endpoint,
      body:     client.buildRequest(prompt, rmId, sessionId, personaJwt),
    })
  }, [selectedAgent, rmId, sessionId, personaJwt, run, pushPhase])

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
    // Use replaceState so "New Session" clears the back stack rather than
    // letting the user navigate back into a stale session.
    window.history.replaceState({ phase: PHASES.SELECT }, '', '/')
  }, [reset, newSession])

  const goToSelect = useCallback(() => {
    reset()
    setPhase(PHASES.SELECT)
    setSelectedAgent(null)
    pushPhase(PHASES.SELECT)
  }, [reset, pushPhase])

  const goToConfigure = useCallback(() => {
    reset()
    setPhase(PHASES.CONFIGURE)
    pushPhase(PHASES.CONFIGURE, { selectedAgentId: selectedAgent?.id })
  }, [reset, selectedAgent, pushPhase])

  // ── Data source navigation ───────────────────────────────────────────────────
  const handleDataSourceClick = useCallback((sourceId) => {
    setPrevPhase(phase)
    setSelectedSource(sourceId)
    setPhase(PHASES.DATA_SOURCE)
    pushPhase(PHASES.DATA_SOURCE, { selectedSource: sourceId, prevPhase: phase })
  }, [phase, pushPhase])

  // Back from DATA_SOURCE — let the browser restore the previous entry.
  const handleDataSourceBack = useCallback(() => {
    window.history.back()
  }, [])

  // ── Help / Settings / Profile navigation ────────────────────────────────────
  const openHelp = useCallback(() => {
    setPrevPhase(phase)
    setPhase(PHASES.HELP)
    pushPhase(PHASES.HELP, { prevPhase: phase })
  }, [phase, pushPhase])

  const openSettings = useCallback(() => {
    setPrevPhase(phase)
    setPhase(PHASES.SETTINGS)
    pushPhase(PHASES.SETTINGS, { prevPhase: phase })
  }, [phase, pushPhase])

  const openProfile = useCallback(() => {
    setPrevPhase(phase)
    setPhase(PHASES.PROFILE)
    pushPhase(PHASES.PROFILE, { prevPhase: phase })
  }, [phase, pushPhase])

  // Back from any overlay (Help / Settings / Profile / DataSource) —
  // delegate entirely to the browser so back button and UI button are identical.
  const closeOverlay = useCallback(() => {
    window.history.back()
  }, [])

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
        onDataSourceClick={handleDataSourceClick}
        onLogoClick={goToSelect}
        onProfileClick={openProfile}
      />

      {/* ── Content column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Sub-header — sits flush with sidebar logo, same h-14 height */}
        <header className="shrink-0 h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10">
          <Breadcrumb
            phase={phase}
            agent={selectedAgent}
            selectedSourceId={selectedSource}
            onSelectClick={goToSelect}
            onAgentClick={goToConfigure}
          />
          <div className="flex items-center gap-2">
            <StatusPill status={status} />
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <a
              href="/help"
              onClick={(e) => { e.preventDefault(); openHelp() }}
              title="Help & documentation"
              className={`p-1.5 rounded-lg transition-colors inline-flex items-center
                ${phase === PHASES.HELP
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              <HelpCircle className="w-4 h-4" />
            </a>
            <a
              href="/settings"
              onClick={(e) => { e.preventDefault(); openSettings() }}
              title="Settings"
              className={`p-1.5 rounded-lg transition-colors inline-flex items-center
                ${phase === PHASES.SETTINGS
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              <Settings className="w-4 h-4" />
            </a>
          </div>
        </header>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Phase: PROFILE */}
          {phase === PHASES.PROFILE && (
            <div className="flex-1 overflow-hidden bg-white">
              <UserProfile
                rmId={rmId}
                onRmIdChange={setRmId}
                sessionId={sessionId}
                settings={{ ...settings, personaName }}
                onOpenSettings={() => {
                  setPrevPhase(PHASES.PROFILE)
                  setPhase(PHASES.SETTINGS)
                  pushPhase(PHASES.SETTINGS, { prevPhase: PHASES.PROFILE })
                }}
                onBack={closeOverlay}
              />
            </div>
          )}

          {/* Phase: HELP */}
          {phase === PHASES.HELP && (
            <div className="flex-1 overflow-hidden bg-white">
              <HelpGuide onBack={closeOverlay} />
            </div>
          )}

          {/* Phase: SETTINGS */}
          {phase === PHASES.SETTINGS && (
            <div className="flex-1 overflow-hidden bg-white">
              <SettingsPanel
                settings={settings}
                onChange={handleSettingChange}
                onBack={closeOverlay}
                rmId={rmId}
                onRmIdChange={setRmId}
              />
            </div>
          )}

          {/* Phase: DATA_SOURCE — data source detail page */}
          {phase === PHASES.DATA_SOURCE && (
            <div className="flex-1 overflow-hidden bg-white">
              <DataSourceDetail
                sourceId={selectedSource}
                onBack={handleDataSourceBack}
              />
            </div>
          )}

          {/* Phase: SELECT — Staff Directory */}
          {phase === PHASES.SELECT && (
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Your Intelligence Team</h1>
                <p className="text-slate-500 mt-1">
                  AI workers embedded in your workflows — each with a defined role, data access, and specialist skills.
                </p>
              </div>
              <AgentSelector
                onSelect={handleAgentSelect}
                onDataSourceClick={handleDataSourceClick}
                cardMinWidth={settings.cardMinWidth}
                showComingSoon={settings.showComingSoon}
              />
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
              thinkingText={thinkingText}
              thinkingLog={thinkingLog}
              toolCalls={toolCalls}
            />
          )}

        </main>
      </div>
    </div>
  )
}
