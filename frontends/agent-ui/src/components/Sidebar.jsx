/**
 * Sidebar — Main navigation sidebar with agent selection.
 *
 * Chat-first design: the sidebar shows available agents as clickable items.
 * Clicking an agent sets it as the active responder in the chat.
 *
 * Features:
 *   • Full sidebar on desktop (>= 1024px)
 *   • Collapsible overlay on mobile (< 1024px)
 *   • Clickable agent list with active indicator
 *   • Data source list for selected agent
 *   • Test persona selector
 *   • User identity and session controls
 */

import { useEffect, useRef } from 'react'
import { Zap, X, MessageSquarePlus, Check } from 'lucide-react'
import PersonaSelector from './PersonaSelector.jsx'
import { AGENTS } from '../config/agents.js'

export default function Sidebar({
  agent, rmId, sessionId, isOpen, onClose,
  onNewSession, onPersonaChange, onDataSourceClick,
  onLogoClick, onProfileClick, onAgentSelect,
}) {
  const sidebarRef = useRef(null)

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Focus trap on mobile
  useEffect(() => {
    if (isOpen) sidebarRef.current?.focus()
  }, [isOpen])

  const activeAgents = AGENTS.filter((a) => !a.comingSoon)
  const comingSoonAgents = AGENTS.filter((a) => a.comingSoon)

  const sidebarContent = (
    <>
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="px-5 h-14 flex items-center border-b border-slate-700/60 shrink-0 justify-between">
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); onLogoClick() }}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          title="New session"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight tracking-tight">Enterprise AI</p>
            <p className="text-xs text-slate-400 leading-tight">Agentic Platform</p>
          </div>
        </a>
        <button
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          aria-label="Close sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── New chat button ──────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
            border border-slate-700/60 hover:border-slate-600 hover:bg-slate-800/50
            text-sm text-slate-300 hover:text-white transition-all"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* ── Agent list ───────────────────────────────────────────────────── */}
      <div className="px-4 py-3 flex-1 overflow-y-auto space-y-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1">
            Agents
          </p>
          <div className="space-y-0.5">
            {activeAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => onAgentSelect?.(a)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all
                  ${agent?.id === a.id
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-white border border-transparent'
                  }`}
                title={a.tagline}
              >
                <span className="text-base">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold leading-tight truncate">{a.workerName}</p>
                  <p className="text-[10px] text-slate-500 leading-tight truncate mt-0.5">{a.tagline}</p>
                </div>
                {agent?.id === a.id && (
                  <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Coming soon agents */}
        {comingSoonAgents.length > 0 && (
          <div>
            <p className="text-xs text-slate-600 uppercase tracking-widest font-semibold mb-2 px-1">
              Coming Soon
            </p>
            <div className="space-y-0.5">
              {comingSoonAgents.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-slate-600 rounded-lg"
                >
                  <span className="text-base opacity-50">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-tight truncate">{a.workerName}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data sources for selected agent */}
        {agent?.dataSources?.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1">
              Data Sources
            </p>
            <div className="space-y-0.5">
              {agent.dataSources.map((src) => (
                src.sourceId ? (
                  <a
                    key={src.label}
                    href={`/data/${src.sourceId}`}
                    onClick={(e) => { e.preventDefault(); onDataSourceClick?.(src.sourceId) }}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-300
                      hover:bg-slate-800/50 transition-colors group"
                    title={`View ${src.label} details`}
                  >
                    <span className="text-sm">{src.icon}</span>
                    <span className="group-hover:text-white transition-colors">{src.label}</span>
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Connected" />
                  </a>
                ) : (
                  <div key={src.label} className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-slate-300">
                    <span className="text-sm">{src.icon}</span>
                    <span>{src.label}</span>
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  </div>
                )
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Test Persona ──────────────────────────────────────────────────── */}
      <div className="px-4 pb-2">
        <PersonaSelector onPersonaChange={onPersonaChange} />
      </div>

      {/* ── User identity ─────────────────────────────────────────────────── */}
      <div className="px-4 py-4 border-t border-slate-700/60 space-y-3">
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
            <p className="text-[10px] text-slate-500 leading-tight">View profile</p>
          </div>
        </a>
        <p className="text-xs text-slate-600 text-center truncate" title={sessionId}>
          Session {sessionId.slice(0, 8)}\u2026
        </p>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex w-60 shrink-0 bg-slate-900 text-white flex-col h-full"
        role="navigation"
        aria-label="Main sidebar"
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        className={`lg:hidden fixed inset-y-0 left-0 w-64 bg-slate-900 text-white flex flex-col z-50
          transform transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        role="navigation"
        aria-label="Main sidebar"
        aria-hidden={!isOpen}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
