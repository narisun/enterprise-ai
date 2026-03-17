/**
 * AgentSelector — Phase 1 of the app.
 *
 * Displays a card grid of available agents. Clicking a card calls onSelect(agent).
 * Agents that are not yet live are shown as "coming soon" and are non-interactive.
 */

import { ArrowRight, Database, Newspaper, Building2 } from 'lucide-react'

const COLOR_MAP = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',  badge: 'bg-blue-100 text-blue-700',   icon: 'text-blue-600', btn: 'bg-blue-600 hover:bg-blue-700' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700', icon: 'text-violet-600', btn: 'bg-violet-600 hover:bg-violet-700' },
  emerald:{ bg: 'bg-emerald-50',border: 'border-emerald-200',badge: 'bg-emerald-100 text-emerald-700',icon: 'text-emerald-600',btn: 'bg-emerald-600 hover:bg-emerald-700'},
  amber:  { bg: 'bg-amber-50',  border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700',  icon: 'text-amber-600',  btn: 'bg-amber-600 hover:bg-amber-700' },
}

const DATA_SOURCE_ICONS = {
  'Salesforce CRM':  <Building2 className="w-3.5 h-3.5" />,
  'Payments System': <Database   className="w-3.5 h-3.5" />,
  'Internet News':   <Newspaper  className="w-3.5 h-3.5" />,
}

export default function AgentSelector({ agents, onSelect }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl">
      {agents.map((agent) => {
        const c = COLOR_MAP[agent.color] ?? COLOR_MAP.blue
        const isLive = !agent.comingSoon

        return (
          <div
            key={agent.id}
            className={`
              relative rounded-2xl border-2 p-6 flex flex-col gap-4 transition-all duration-200
              ${isLive
                ? `${c.bg} ${c.border} cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0`
                : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'}
            `}
            onClick={() => isLive && onSelect(agent)}
            role={isLive ? 'button' : undefined}
            tabIndex={isLive ? 0 : undefined}
            onKeyDown={(e) => { if (isLive && (e.key === 'Enter' || e.key === ' ')) onSelect(agent) }}
          >
            {/* Coming soon badge */}
            {agent.comingSoon && (
              <span className="absolute top-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
                Coming soon
              </span>
            )}

            {/* Icon + Name */}
            <div className="flex items-start gap-3">
              <div className={`text-3xl leading-none mt-0.5`}>{agent.icon}</div>
              <div>
                <h3 className="font-semibold text-slate-900 text-base leading-tight">{agent.name}</h3>
                <p className={`text-xs font-medium mt-0.5 ${c.icon}`}>{agent.tagline}</p>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-slate-600 leading-relaxed flex-1">{agent.description}</p>

            {/* Data sources */}
            {agent.dataSources?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {agent.dataSources.map((src) => (
                  <span
                    key={src.label}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${c.badge}`}
                  >
                    {DATA_SOURCE_ICONS[src.label] ?? src.icon}
                    {src.label}
                  </span>
                ))}
              </div>
            )}

            {/* CTA */}
            {isLive && (
              <button
                className={`mt-1 w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors ${c.btn}`}
                onClick={(e) => { e.stopPropagation(); onSelect(agent) }}
              >
                Launch Agent
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
