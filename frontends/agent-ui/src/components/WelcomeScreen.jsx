/**
 * WelcomeScreen — Empty chat state with smart suggestion cards.
 *
 * ── Phase 2: Prompt templates as suggestions ─────────────────────────────
 * Instead of a PromptBuilder form that gates the user, suggestions are
 * shown as clickable cards. Two behaviours:
 *
 *   • Click a card → pre-fills the chat input (user can edit before sending)
 *   • Click the arrow → sends immediately
 *
 * When no agent is selected, generic cross-agent suggestions are shown.
 * The intent router (Phase 3) will auto-select the agent on send.
 *
 * ── Phase 3 integration ─────────────────────────────────────────────────
 * Agent chips are shown so the user can optionally pick one, but they
 * don't have to. Typing naturally and hitting send works fine — the
 * intent router handles it.
 */

import { useState } from 'react'
import { Sparkles, ArrowRight, Zap, Send } from 'lucide-react'
import { AGENTS } from '../config/agents.js'

// ── Suggestion card ─────────────────────────────────────────────────────
function SuggestionCard({ icon, title, description, onPrefill, onSend }) {
  return (
    <div className="group flex items-center w-full rounded-xl border border-slate-200 bg-white
      hover:border-blue-300 hover:shadow-md transition-all duration-150 overflow-hidden">
      <button
        onClick={onPrefill}
        className="flex-1 flex items-start gap-3 text-left px-4 py-3.5"
      >
        <span className="text-lg mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 group-hover:text-blue-700 transition-colors">
            {title}
          </p>
          {description && (
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </button>
      <button
        onClick={onSend}
        className="shrink-0 px-3 py-3.5 text-slate-300 hover:text-blue-500
          hover:bg-blue-50 transition-colors self-stretch flex items-center border-l border-slate-100"
        aria-label="Send immediately"
        title="Send immediately"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Agent selector chip ─────────────────────────────────────────────────
function AgentChip({ agent, isSelected, onClick }) {
  return (
    <button
      onClick={() => onClick(agent)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all
        ${isSelected
          ? 'border-blue-300 bg-blue-50 text-blue-700 shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50'
        }`}
    >
      <span>{agent.icon}</span>
      <span>{agent.workerName}</span>
    </button>
  )
}

export default function WelcomeScreen({ agent, onSelectAgent, onSendMessage, onPrefill }) {
  const activeAgents = AGENTS.filter((a) => !a.comingSoon)

  // Build suggestions — generic when no agent, agent-specific when selected
  const suggestions = agent ? [
    {
      icon: agent.icon,
      title: agent.template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const v = agent.template.variables.find((vr) => vr.key === key)
        return v?.placeholder?.replace('e.g. ', '') ?? `[${key}]`
      }),
      description: agent.tagline,
      prompt: agent.template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const v = agent.template.variables.find((vr) => vr.key === key)
        return v?.placeholder?.replace('e.g. ', '') ?? key
      }),
    },
    ...(agent.followUps ?? []).slice(0, 3).map((f) => ({
      icon: '\u2728',
      title: f,
      description: null,
      prompt: f,
    })),
  ] : [
    {
      icon: '\uD83E\uDD1D',
      title: 'Prepare me for a client meeting',
      description: 'Generate a comprehensive brief with CRM data, payments, and news',
      prompt: 'Prepare a full meeting brief for customer Acme Manufacturing',
    },
    {
      icon: '\uD83D\uDCCA',
      title: 'Scan my portfolio for risks',
      description: 'Review your entire client book for payment stress and risk signals',
      prompt: 'Run a portfolio watch scan for my book',
    },
    {
      icon: '\uD83D\uDCC8',
      title: 'What are the key risks in my book?',
      description: 'Get a summary of payment stress, covenant issues, and adverse news',
      prompt: 'What are the key risks across my client book this week?',
    },
    {
      icon: '\uD83D\uDCDD',
      title: 'Draft talking points for a client',
      description: 'Generate discussion topics for your next client conversation',
      prompt: 'Prepare talking points for my meeting with IBM',
    },
  ]

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-12 animate-fade-in">
      <div className="max-w-xl w-full text-center">
        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-5 shadow-lg">
          {agent
            ? <span className="text-2xl">{agent.icon}</span>
            : <Zap className="w-7 h-7 text-white" />
          }
        </div>

        {/* Greeting */}
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {agent ? agent.workerName : 'How can I help you today?'}
        </h1>
        <p className="text-sm text-slate-500 mb-8 max-w-md mx-auto">
          {agent
            ? agent.description
            : 'Your AI-powered assistant for client intelligence, portfolio monitoring, and meeting preparation. Just type naturally or pick a suggestion below.'
          }
        </p>

        {/* Agent selector chips — always visible */}
        <div className="mb-8">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">
            <Sparkles className="w-3 h-3 inline mr-1" />
            {agent ? 'Switch specialist' : 'Choose a specialist or just start typing'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {activeAgents.map((a) => (
              <AgentChip
                key={a.id}
                agent={a}
                isSelected={agent?.id === a.id}
                onClick={onSelectAgent}
              />
            ))}
          </div>
        </div>

        {/* Suggestion cards */}
        <div className="space-y-2 text-left">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3 px-1">
            <Sparkles className="w-3 h-3 inline mr-1" />
            Try asking
          </p>
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              icon={s.icon}
              title={s.title}
              description={s.description}
              onPrefill={() => onPrefill?.(s.prompt)}
              onSend={() => onSendMessage(s.prompt)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
