/**
 * AgentSelector — Staff Directory view.
 *
 * Renders digital workers grouped by department, styled as an employee
 * directory rather than a software catalogue.
 *
 * Live workers show a "Work with [Name]" CTA.
 * Coming-soon workers show an "In Development" badge and are non-interactive.
 *
 * Data source chips are clickable buttons that navigate to the DataSourceDetail
 * page via the onDataSourceClick prop threaded down from App.jsx.
 */

import { ArrowRight } from 'lucide-react'
import { byDepartment, DEPARTMENTS } from '../config/agents.js'

// ── Colour tokens ─────────────────────────────────────────────────────────────
const COLOR_MAP = {
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50',    avatar: 'bg-blue-600',    role: 'text-blue-600',   badge: 'bg-blue-100 text-blue-700',   btn: 'bg-blue-600 hover:bg-blue-700',   src: 'bg-blue-100 text-blue-700'   },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50',  avatar: 'bg-violet-600',  role: 'text-violet-600', badge: 'bg-violet-100 text-violet-700', btn: 'bg-violet-600 hover:bg-violet-700', src: 'bg-violet-100 text-violet-700' },
  emerald:{ border: 'border-emerald-200',bg: 'bg-emerald-50', avatar: 'bg-emerald-600', role: 'text-emerald-600',badge: 'bg-emerald-100 text-emerald-700',btn: 'bg-emerald-600 hover:bg-emerald-700',src: 'bg-emerald-100 text-emerald-700'},
  amber:  { border: 'border-amber-200',  bg: 'bg-amber-50',   avatar: 'bg-amber-600',   role: 'text-amber-600',  badge: 'bg-amber-100 text-amber-700',  btn: 'bg-amber-600 hover:bg-amber-700',  src: 'bg-amber-100 text-amber-700'  },
  rose:   { border: 'border-rose-200',   bg: 'bg-rose-50',    avatar: 'bg-rose-600',    role: 'text-rose-600',   badge: 'bg-rose-100 text-rose-700',   btn: 'bg-rose-600 hover:bg-rose-700',   src: 'bg-rose-100 text-rose-700'   },
  teal:   { border: 'border-teal-200',   bg: 'bg-teal-50',    avatar: 'bg-teal-600',    role: 'text-teal-600',   badge: 'bg-teal-100 text-teal-700',   btn: 'bg-teal-600 hover:bg-teal-700',   src: 'bg-teal-100 text-teal-700'   },
  indigo: { border: 'border-indigo-200', bg: 'bg-indigo-50',  avatar: 'bg-indigo-600',  role: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700', btn: 'bg-indigo-600 hover:bg-indigo-700', src: 'bg-indigo-100 text-indigo-700' },
  orange: { border: 'border-orange-200', bg: 'bg-orange-50',  avatar: 'bg-orange-600',  role: 'text-orange-600', badge: 'bg-orange-100 text-orange-700', btn: 'bg-orange-600 hover:bg-orange-700', src: 'bg-orange-100 text-orange-700' },
}

// ── Worker card ───────────────────────────────────────────────────────────────
function WorkerCard({ agent, onSelect, onDataSourceClick }) {
  const c      = COLOR_MAP[agent.color] ?? COLOR_MAP.blue
  const isLive = !agent.comingSoon

  return (
    <div
      className={`
        relative flex flex-col rounded-2xl border-2 p-5 gap-4 transition-all duration-200
        ${isLive
          ? `${c.bg} ${c.border} cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0`
          : 'bg-slate-50 border-slate-200 cursor-not-allowed'}
      `}
      onClick={() => isLive && onSelect(agent)}
      role={isLive ? 'button' : undefined}
      tabIndex={isLive ? 0 : undefined}
      onKeyDown={(e) => { if (isLive && (e.key === 'Enter' || e.key === ' ')) onSelect(agent) }}
    >
      {/* Status pill — top right */}
      <div className="absolute top-4 right-4">
        {isLive ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
            In Development
          </span>
        )}
      </div>

      {/* Avatar + name block */}
      <div className="flex items-center gap-3 pr-24">
        <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-base
          ${isLive ? c.avatar : 'bg-slate-300'}
        `}>
          {agent.icon}
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 text-lg leading-tight">{agent.workerName}</h3>
          <p className={`text-xs font-semibold leading-snug mt-0.5 ${isLive ? c.role : 'text-slate-400'}`}>
            {agent.workerRole}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-600 leading-relaxed flex-1">
        {agent.description}
      </p>

      {/* Data source chips — clickable buttons */}
      {agent.dataSources?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agent.dataSources.map((src) => (
            src.sourceId ? (
              <a
                key={src.label}
                href={`/data/${src.sourceId}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDataSourceClick?.(src.sourceId)
                }}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium
                  transition-all hover:scale-105 hover:shadow-sm cursor-pointer
                  ${isLive ? c.src : 'bg-slate-100 text-slate-400'}`}
                title={`View ${src.label} schema & details`}
              >
                <span>{src.icon}</span>
                {src.label}
                <span className="ml-0.5 opacity-60 text-[9px]">↗</span>
              </a>
            ) : (
              <span
                key={src.label}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium
                  ${isLive ? c.src : 'bg-slate-100 text-slate-400'}`}
              >
                <span>{src.icon}</span>
                {src.label}
              </span>
            )
          ))}
        </div>
      )}

      {/* CTA */}
      {isLive && (
        <button
          className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white
            flex items-center justify-center gap-2 transition-colors ${c.btn}`}
          onClick={(e) => { e.stopPropagation(); onSelect(agent) }}
        >
          Work with {agent.workerName}
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// ── Department section ────────────────────────────────────────────────────────
function DepartmentSection({ name, workers, onSelect, onDataSourceClick, cardMinWidth = 280 }) {
  const liveCount   = workers.filter((w) => !w.comingSoon).length
  const totalCount  = workers.length

  return (
    <section>
      {/* Department header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{name}</h2>
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400 font-medium">
          {liveCount > 0
            ? `${liveCount} of ${totalCount} active`
            : `${totalCount} in development`}
        </span>
      </div>

      {/* Worker cards grid — auto-fill: as many columns as fit */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))` }}>
        {workers.map((agent) => (
          <WorkerCard
            key={agent.id}
            agent={agent}
            onSelect={onSelect}
            onDataSourceClick={onDataSourceClick}
          />
        ))}
      </div>
    </section>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AgentSelector({ onSelect, onDataSourceClick, cardMinWidth = 280, showComingSoon = true }) {
  const grouped   = byDepartment()
  const allAgents = Object.values(grouped).flat()
  const liveCount = allAgents.filter((a) => !a.comingSoon).length
  const totalCount = allAgents.length

  return (
    <div className="space-y-10 max-w-6xl">

      {/* Directory summary bar */}
      <div className="flex items-center gap-6 pb-4 border-b border-slate-200">
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-900">{totalCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total Workers</p>
        </div>
        <div className="w-px h-10 bg-slate-200" />
        <div className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{liveCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Active Now</p>
        </div>
        <div className="w-px h-10 bg-slate-200" />
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-400">{totalCount - liveCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">In Development</p>
        </div>
        <div className="flex-1" />
        <p className="text-xs text-slate-400 italic">
          Click any active worker to start · click data sources to explore schemas
        </p>
      </div>

      {/* Department sections */}
      {DEPARTMENTS.filter((d) => grouped[d]).map((dept) => {
        const workers = showComingSoon
          ? grouped[dept]
          : grouped[dept].filter((a) => !a.comingSoon)
        if (!workers.length) return null
        return (
          <DepartmentSection
            key={dept}
            name={dept}
            workers={workers}
            onSelect={onSelect}
            onDataSourceClick={onDataSourceClick}
            cardMinWidth={cardMinWidth}
          />
        )
      })}

    </div>
  )
}
