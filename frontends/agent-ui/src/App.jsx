/**
 * App.jsx — Chat-first root shell with URL-based routing.
 *
 * ── Architecture ────────────────────────────────────────────────────────────
 * The main view is ALWAYS the chat. Overlays (help, settings, profile,
 * data-source) slide over it. URL routing via the History API gives us:
 *   • Address bar always shows where you are (/agent/rm-prep, /help, etc.)
 *   • Browser back/forward buttons navigate between views
 *   • Deep-linking support (share a URL, bookmark it)
 *
 * URL scheme:
 *   /                    — Chat (no agent)
 *   /agent/:agentId      — Chat with a specific agent
 *   /help                — Help overlay
 *   /settings            — Settings overlay
 *   /profile             — Profile overlay
 *   /data-source/:id     — Data source overlay
 *
 * State is composed from:
 *   • useChat       — message history + streaming state
 *   • useSession    — stable session UUID
 *   • useSettings   — persisted preferences
 *   • useRouter     — URL ↔ view state synchronisation
 *   • selectedAgent — which specialist agent to use (auto or manual)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { HelpCircle, Settings, Menu } from 'lucide-react'

import Sidebar          from './components/Sidebar.jsx'
import ChatView         from './components/ChatView.jsx'
import DataSourceDetail from './components/DataSourceDetail.jsx'
import HelpGuide        from './components/HelpGuide.jsx'
import SettingsPanel    from './components/SettingsPanel.jsx'
import UserProfile      from './components/UserProfile.jsx'
import StatusPill       from './components/StatusPill.jsx'

import { useChat }      from './hooks/useChat.js'
import { useSession }   from './hooks/useSession.js'
import { useSettings }  from './hooks/useSettings.js'
import { useRouter }    from './hooks/useRouter.js'
import { AGENTS, getAgent } from './config/agents.js'
import { routeToAgent } from './lib/intentRouter.js'

export default function App() {
  // ── Core state ──────────────────────────────────────────────────────────
  const [rmId, setRmId]               = useState('RM')
  const [personaName, setPersonaName] = useState(null)
  const [personaJwt, setPersonaJwt]   = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState(null)

  const { sessionId, newSession } = useSession()
  const { settings, updateSetting } = useSettings()

  // ── Router — URL ↔ view state sync ────────────────────────────────────
  const router = useRouter({ getAgentById: getAgent })

  // Determine overlay from route
  const overlay = (() => {
    switch (router.route.view) {
      case 'help':        return 'help'
      case 'settings':    return 'settings'
      case 'profile':     return 'profile'
      case 'data-source': return 'data-source'
      default:            return null
    }
  })()
  const overlayData = router.route.view === 'data-source' ? router.route.param : null

  // ── Resolve agent from URL on initial load ────────────────────────────
  const initialised = useRef(false)
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      const agentFromUrl = router.resolveInitialAgent()
      if (agentFromUrl) {
        setSelectedAgent(agentFromUrl)
      }
    }
  }, [router])

  // ── Keep URL in sync when agent changes ────────────────────────────────
  useEffect(() => {
    // Only update URL when we're on the chat view (not overlays)
    if (!overlay) {
      router.navigateToChat(selectedAgent?.id ?? null)
    }
  }, [selectedAgent, overlay]) // eslint-disable-line react-hooks/exhaustive-deps

  const chat = useChat({
    sessionId,
    rmId,
    personaJwt,
  })

  // ── Focus management ────────────────────────────────────────────────────
  const mainRef = useRef(null)

  // ── Keyboard handler — Escape goes back / closes sidebar ──────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (overlay) {
          // Go back to chat (which might have an agent in its URL)
          router.navigateToChat(selectedAgent?.id ?? null)
        }
        if (sidebarOpen) setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [overlay, sidebarOpen, selectedAgent, router])

  // ── Persona handler ────────────────────────────────────────────────────
  const handlePersonaChange = useCallback((name, jwt) => {
    setPersonaName(name)
    setPersonaJwt(jwt)
  }, [])

  // ── Agent selection — always returns to chat view ──────────────────────
  const handleSelectAgent = useCallback((agent) => {
    setSelectedAgent(agent)
    setSidebarOpen(false)
    // Navigate to chat with the new agent — closes any open overlay
    router.navigateToChat(agent?.id ?? null)
  }, [router])

  // ── Chat send — auto-routes via intent router when no agent selected ──
  const handleSend = useCallback((content) => {
    let agent = selectedAgent

    if (!agent) {
      const routed = routeToAgent(content)
      if (routed) {
        agent = routed.agent
        setSelectedAgent(agent)
      }
    }

    if (!agent) {
      agent = AGENTS.find((a) => !a.comingSoon)
      if (agent) {
        setSelectedAgent(agent)
      }
    }

    if (!agent) return
    chat.sendMessage(content, agent)
  }, [selectedAgent, chat])

  // ── Retry last failed message ─────────────────────────────────────────
  const handleRetry = useCallback(() => {
    const agent = selectedAgent ?? AGENTS.find((a) => !a.comingSoon)
    if (agent) {
      chat.retry(agent)
    }
  }, [selectedAgent, chat])

  // ── New session — clears chat and resets ──────────────────────────────
  const handleNewSession = useCallback(() => {
    chat.clearChat()
    setSelectedAgent(null)
    newSession()
    router.navigateToChat(null)
  }, [chat, newSession, router])

  // ── Overlay navigation — all go through the router ────────────────────
  const openDataSource = useCallback((sourceId) => {
    router.navigateToOverlay('data-source', sourceId)
  }, [router])

  const openHelp     = useCallback(() => router.navigateToOverlay('help'), [router])
  const openSettings = useCallback(() => router.navigateToOverlay('settings'), [router])
  const openProfile  = useCallback(() => router.navigateToOverlay('profile'), [router])

  const closeOverlay = useCallback(() => {
    router.navigateToChat(selectedAgent?.id ?? null)
  }, [router, selectedAgent])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex overflow-hidden bg-slate-50">

      {/* ── Skip navigation ───────────────────────────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2
          focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm"
      >
        Skip to main content
      </a>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <Sidebar
        agent={selectedAgent}
        rmId={rmId}
        sessionId={sessionId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewSession={handleNewSession}
        onPersonaChange={handlePersonaChange}
        onDataSourceClick={openDataSource}
        onLogoClick={handleNewSession}
        onProfileClick={openProfile}
        onAgentSelect={handleSelectAgent}
      />

      {/* ── Content column ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header */}
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

            {/* Agent name / view title in header */}
            <div className="flex items-center gap-2">
              {!overlay && selectedAgent && <span className="text-lg">{selectedAgent.icon}</span>}
              <h1 className="text-sm font-semibold text-slate-700">
                {overlay === 'help' ? 'Help & Documentation'
                  : overlay === 'settings' ? 'Settings'
                  : overlay === 'profile' ? 'User Profile'
                  : overlay === 'data-source' ? 'Data Source'
                  : selectedAgent ? selectedAgent.workerName
                  : 'Quantitix AI'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusPill status={chat.isStreaming ? 'streaming' : (chat.messages.length > 0 ? 'complete' : 'idle')} />
            <div className="w-px h-4 bg-slate-200 mx-1 hidden sm:block" />
            <button
              onClick={openHelp}
              title="Help"
              className={`p-1.5 rounded-lg transition-colors inline-flex items-center
                ${overlay === 'help'
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
              aria-label="Help and documentation"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={openSettings}
              title="Settings"
              className={`p-1.5 rounded-lg transition-colors inline-flex items-center
                ${overlay === 'settings'
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex-1 flex flex-col overflow-hidden outline-none"
          aria-live="polite"
        >
          {/* Overlays */}
          {overlay === 'profile' && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <UserProfile
                rmId={rmId}
                onRmIdChange={setRmId}
                sessionId={sessionId}
                settings={{ ...settings, personaName }}
                onOpenSettings={openSettings}
                onBack={closeOverlay}
              />
            </div>
          )}

          {overlay === 'help' && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <HelpGuide onBack={closeOverlay} />
            </div>
          )}

          {overlay === 'settings' && (
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

          {overlay === 'data-source' && (
            <div className="flex-1 overflow-hidden bg-white animate-fade-in">
              <DataSourceDetail
                sourceId={overlayData}
                onBack={closeOverlay}
              />
            </div>
          )}

          {/* Main chat view — shown when no overlay is active */}
          {!overlay && (
            <ChatView
              messages={chat.messages}
              liveStream={chat.liveStream}
              hasLiveResponse={chat.hasLiveResponse}
              isStreaming={chat.isStreaming}
              agent={selectedAgent}
              onSend={handleSend}
              onStop={chat.abort}
              onRetry={handleRetry}
              onSelectAgent={handleSelectAgent}
            />
          )}
        </main>
      </div>
    </div>
  )
}
