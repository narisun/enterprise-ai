/**
 * App.jsx — Root shell that composes hooks and layout components.
 *
 * ── Architecture ────────────────────────────────────────────────────────
 * This file is intentionally thin (~200 lines). All concerns are delegated:
 *   • Phase routing & URL sync  → usePhaseRouter
 *   • SSE streaming state       → useAgentStream
 *   • Settings persistence      → useSettings
 *   • Session management        → useSession
 *   • Layout sidebar            → Sidebar (responsive)
 *   • Navigation breadcrumb     → Breadcrumb
 *   • Status indicator          → StatusPill
 *
 * ── Adding a new phase ──────────────────────────────────────────────────
 *   1. Add the phase to PHASES in usePhaseRouter.js
 *   2. Add the navigation function in usePhaseRouter.js
 *   3. Add the route content block here in the <main> section
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { HelpCircle, Settings, Menu } from 'lucide-react'

import Sidebar           from './components/Sidebar.jsx'
import Breadcrumb        from './components/Breadcrumb.jsx'
import StatusPill        from './components/StatusPill.jsx'
import AgentSelector     from './components/AgentSelector.jsx'
import PromptBuilder     from './components/PromptBuilder.jsx'
import OutputCanvas      from './components/OutputCanvas.jsx'
import DataSourceDetail  from './components/DataSourceDetail.jsx'
import HelpGuide         from './components/HelpGuide.jsx'
import SettingsPanel     from './components/SettingsPanel.jsx'
import UserProfile       from './components/UserProfile.jsx'

import { usePhaseRouter, PHASES } from './hooks/usePhaseRouter.js'
import { useAgentStream }         from './hooks/useAgentStream.js'
import { useSession }              from './hooks/useSession.js'
import { useSettings }             from './hooks/useSettings.js'
import { getAgentClient }          from './api/agentClients.js'

export default function App() {
  // ── State hooks ──────────────────────────────────────────────────────────
  const [rmId,        setRmId]        = useState('RM')
  const [personaName, setPersonaName] = useState(null)
  const [personaJwt,  setPersonaJwt]  = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const { sessionId, newSession } = useSession()
  const { settings, updateSetting } = useSettings()
  const stream = useAgentStream()

  const router = usePhaseRouter({ onResetStream: stream.reset })
  const {
    phase, selectedAgent, selectedSource,
    selectAgent, goToExecute, goToSelect, goToConfigure,
    openDataSource, openHelp, openSettings, openProfile,
    closeOverlay, startNewSession,
  } = router

  // ── Focus management — announce phase changes to screen readers ────────
  const mainRef = useRef(null)
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      prevPhaseRef.current = phase
      // Move focus to main content on phase change for assistive tech
      mainRef.current?.focus()
    }
  }, [phase])

  // ── Global keyboard handler — Escape closes overlays ───────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (phase === PHASES.HELP || phase === PHASES.SETTINGS || phase === PHASES.PROFILE || phase === PHASES.DATA_SOURCE) {
          closeOverlay()
        }
        if (sidebarOpen) setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, closeOverlay, sidebarOpen])

  // ── Persona handler ────────────────────────────────────────────────────
  const handlePersonaChange = useCallback((name, jwt) => {
    setPersonaName(name)
    setPersonaJwt(jwt)
  }, [])

  // ── Agent prompt submission ────────────────────────────────────────────
  const handlePromptSubmit = useCallback(async (prompt) => {
    goToExecute()
    const client = getAgentClient(selectedAgent.id)
    await stream.run({
      endpoint: client.endpoint,
      body:     client.buildRequest(prompt, rmId, sessionId, personaJwt),
    })
  }, [selectedAgent, rmId, sessionId, personaJwt, stream.run, goToExecute])

  // Follow-up refinement — keeps same session
  const handleRefine = useCallback(async (prompt) => {
    const client = getAgentClient(selectedAgent.id)
    await stream.run({
      endpoint: client.endpoint,
      body:     client.buildRequest(prompt, rmId, sessionId, personaJwt),
    })
  }, [selectedAgent, rmId, sessionId, personaJwt, stream.run])

  const handleNewSession = useCallback(() => {
    startNewSession()
    newSession()
  }, [startNewSession, newSession])

  const handleOpenSettings = useCallback(() => {
    openSettings()
  }, [openSettings])

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">

      {/* ── Skip navigation link (accessibility) ─────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2
          focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm"
      >
        Skip to main content
      </a>

      {/* ── Sidebar — responsive ─────────────────────────────────────────── */}
      <Sidebar
        agent={selectedAgent}
        rmId={rmId}
        sessionId={sessionId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewSession={handleNewSession}
        onPersonaChange={handlePersonaChange}
        onDataSourceClick={openDataSource}
        onLogoClick={goToSelect}
        onProfileClick={openProfile}
      />

      {/* ── Content column ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Sub-header */}
        <header className="shrink-0 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              aria-label="Open sidebar menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Breadcrumb
              phase={phase}
              agent={selectedAgent}
              selectedSourceId={selectedSource}
              onSelectClick={goToSelect}
              onAgentClick={goToConfigure}
            />
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={stream.status} />
            <div className="w-px h-4 bg-slate-200 mx-1 hidden sm:block" />
            <a
              href="/help"
              onClick={(e) => { e.preventDefault(); openHelp() }}
              title="Help & documentation"
              className={`p-1.5 rounded-lg transition-colors inline-flex items-center
                ${phase === PHASES.HELP
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
              aria-label="Help and documentation"
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
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </a>
          </div>
        </header>

        {/* ── Main content ────────────────────────────────────────────────── */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex-1 flex flex-col overflow-hidden outline-none"
          aria-live="polite"
        >
          {/* Phase: PROFILE */}
          {phase === PHASES.PROFILE && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <UserProfile
                rmId={rmId}
                onRmIdChange={setRmId}
                sessionId={sessionId}
                settings={{ ...settings, personaName }}
                onOpenSettings={handleOpenSettings}
                onBack={closeOverlay}
              />
            </div>
          )}

          {/* Phase: HELP */}
          {phase === PHASES.HELP && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <HelpGuide onBack={closeOverlay} />
            </div>
          )}

          {/* Phase: SETTINGS */}
          {phase === PHASES.SETTINGS && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <SettingsPanel
                settings={settings}
                onChange={updateSetting}
                onBack={closeOverlay}
                rmId={rmId}
                onRmIdChange={setRmId}
              />
            </div>
          )}

          {/* Phase: DATA_SOURCE */}
          {phase === PHASES.DATA_SOURCE && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <DataSourceDetail
                sourceId={selectedSource}
                onBack={() => window.history.back()}
              />
            </div>
          )}

          {/* Phase: SELECT — Staff Directory */}
          {phase === PHASES.SELECT && (
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 animate-fade-in">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Your Intelligence Team</h1>
                <p className="text-slate-500 mt-1">
                  AI workers embedded in your workflows — each with a defined role, data access, and specialist skills.
                </p>
              </div>
              <AgentSelector
                onSelect={selectAgent}
                onDataSourceClick={openDataSource}
                cardMinWidth={settings.cardMinWidth}
                showComingSoon={settings.showComingSoon}
              />
            </div>
          )}

          {/* Phase: CONFIGURE */}
          {phase === PHASES.CONFIGURE && selectedAgent && (
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 animate-fade-in">
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

          {/* Phase: EXECUTE — full-width canvas with streaming UX */}
          {phase === PHASES.EXECUTE && (
            <OutputCanvas
              output={stream.output}
              streamingText={stream.streamingText}
              clientName={stream.clientName}
              status={stream.status}
              error={stream.error}
              onRefine={handleRefine}
              onRetry={() => handlePromptSubmit(stream.output ? '' : 'retry')}
              agent={selectedAgent}
              steps={stream.steps}
              activeStep={stream.activeStep}
              thoughts={stream.thoughts}
              thinkingText={stream.thinkingText}
              thinkingLog={stream.thinkingLog}
              toolCalls={stream.toolCalls}
            />
          )}
        </main>
      </div>
    </div>
  )
}
