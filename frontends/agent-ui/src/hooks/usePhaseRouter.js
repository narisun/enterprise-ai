/**
 * usePhaseRouter — URL-synced phase state machine.
 *
 * Extracted from App.jsx to isolate routing/navigation concerns from
 * layout and rendering. Independently testable with a history mock.
 *
 * ── Responsibilities ────────────────────────────────────────────────────
 *   • Own all phase state (phase, selectedAgent, selectedSource, prevPhase)
 *   • Sync phase ↔ URL via History API (pushState / replaceState / popstate)
 *   • Expose declarative navigation functions
 *   • Handle deep-link restoration on mount
 *
 * ── What this hook does NOT do ──────────────────────────────────────────
 *   • Manage stream state (that's useAgentStream)
 *   • Manage settings (that's useSettings)
 *   • Render anything
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { AGENTS } from '../config/agents.js'

export const PHASES = {
  SELECT:      'select',
  CONFIGURE:   'configure',
  EXECUTE:     'execute',
  DATA_SOURCE: 'data-source',
  HELP:        'help',
  SETTINGS:    'settings',
  PROFILE:     'profile',
}

// ── URL ↔ phase helpers ───────────────────────────────────────────────────
export function phaseToPath(phase, extra = {}) {
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

export function pathToState(pathname) {
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

/**
 * @param {object} options
 * @param {() => void} options.onResetStream — callback to reset the stream state when navigating away from EXECUTE
 */
export function usePhaseRouter({ onResetStream } = {}) {
  const [phase,          setPhase]          = useState(PHASES.SELECT)
  const [selectedAgent,  setSelectedAgent]  = useState(null)
  const [selectedSource, setSelectedSource] = useState(null)
  const [prevPhase,      setPrevPhase]      = useState(null)

  const isRestoringFromHistory = useRef(false)

  // Low-level push helper
  const pushPhase = useCallback((newPhase, extra = {}) => {
    if (isRestoringFromHistory.current) return
    const path = phaseToPath(newPhase, extra)
    window.history.pushState({ phase: newPhase, ...extra }, '', path)
  }, [])

  // ── Deep-link restoration on mount ──────────────────────────────────────
  useEffect(() => {
    const initialState = pathToState(window.location.pathname)
    window.history.replaceState(
      { phase: initialState.phase, ...initialState },
      '',
      window.location.pathname,
    )
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

  // ── Popstate handler ────────────────────────────────────────────────────
  useEffect(() => {
    const handlePopState = (e) => {
      const s = e.state
      isRestoringFromHistory.current = true

      if (!s) {
        setPhase(PHASES.SELECT)
        setSelectedAgent(null)
        setSelectedSource(null)
        setPrevPhase(null)
        onResetStream?.()
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
      if (restoredPhase !== PHASES.EXECUTE) onResetStream?.()

      isRestoringFromHistory.current = false
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onResetStream])

  // ── Navigation functions ────────────────────────────────────────────────

  const selectAgent = useCallback((agent) => {
    setSelectedAgent(agent)
    setPhase(PHASES.CONFIGURE)
    pushPhase(PHASES.CONFIGURE, { selectedAgentId: agent.id })
  }, [pushPhase])

  const goToExecute = useCallback(() => {
    setPhase(PHASES.EXECUTE)
    pushPhase(PHASES.EXECUTE, { selectedAgentId: selectedAgent?.id })
  }, [pushPhase, selectedAgent])

  const goToSelect = useCallback(() => {
    onResetStream?.()
    setPhase(PHASES.SELECT)
    setSelectedAgent(null)
    pushPhase(PHASES.SELECT)
  }, [onResetStream, pushPhase])

  const goToConfigure = useCallback(() => {
    onResetStream?.()
    setPhase(PHASES.CONFIGURE)
    pushPhase(PHASES.CONFIGURE, { selectedAgentId: selectedAgent?.id })
  }, [onResetStream, selectedAgent, pushPhase])

  const openDataSource = useCallback((sourceId) => {
    setPrevPhase(phase)
    setSelectedSource(sourceId)
    setPhase(PHASES.DATA_SOURCE)
    pushPhase(PHASES.DATA_SOURCE, { selectedSource: sourceId, prevPhase: phase })
  }, [phase, pushPhase])

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

  const closeOverlay = useCallback(() => {
    window.history.back()
  }, [])

  const startNewSession = useCallback(() => {
    onResetStream?.()
    setPhase(PHASES.SELECT)
    setSelectedAgent(null)
    window.history.replaceState({ phase: PHASES.SELECT }, '', '/')
  }, [onResetStream])

  return {
    // State
    phase,
    selectedAgent,
    selectedSource,
    prevPhase,
    // Navigation
    selectAgent,
    goToExecute,
    goToSelect,
    goToConfigure,
    openDataSource,
    openHelp,
    openSettings,
    openProfile,
    closeOverlay,
    startNewSession,
  }
}
