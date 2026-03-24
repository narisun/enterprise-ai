/**
 * Breadcrumb — Navigation breadcrumb trail for the sub-header.
 *
 * Extracted from App.jsx for testability and reuse.
 */

import { LayoutGrid, ChevronRight } from 'lucide-react'
import { PHASES } from '../hooks/usePhaseRouter.js'
import { getDataSource } from '../config/dataSources.js'

export default function Breadcrumb({ phase, agent, selectedSourceId, onSelectClick, onAgentClick }) {
  const source = selectedSourceId ? getDataSource(selectedSourceId) : null

  const isAgentPhase = phase !== PHASES.SELECT && phase !== PHASES.DATA_SOURCE &&
    phase !== PHASES.HELP && phase !== PHASES.SETTINGS && phase !== PHASES.PROFILE

  return (
    <nav className="flex items-center gap-1.5 text-sm text-slate-500 select-none" aria-label="Breadcrumb">
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); onSelectClick() }}
        className="hover:text-slate-800 transition-colors flex items-center gap-1"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Enterprise AI
      </a>

      {isAgentPhase && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <a
            href={agent ? `/agent/${agent.id}` : '#'}
            onClick={(e) => { e.preventDefault(); onAgentClick() }}
            className={`transition-colors ${phase === PHASES.CONFIGURE ? 'text-slate-800 font-medium' : 'hover:text-slate-800'}`}
            aria-current={phase === PHASES.CONFIGURE ? 'page' : undefined}
          >
            {agent?.workerName ?? '\u2026'}
          </a>
        </>
      )}

      {phase === PHASES.EXECUTE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <span className="text-slate-800 font-medium" aria-current="page">Results</span>
        </>
      )}

      {phase === PHASES.DATA_SOURCE && source && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <span className="text-slate-800 font-medium" aria-current="page">
            {source.icon} {source.label}
          </span>
        </>
      )}

      {phase === PHASES.HELP && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <span className="text-slate-800 font-medium" aria-current="page">Help</span>
        </>
      )}

      {phase === PHASES.SETTINGS && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <span className="text-slate-800 font-medium" aria-current="page">Settings</span>
        </>
      )}

      {phase === PHASES.PROFILE && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
          <span className="text-slate-800 font-medium" aria-current="page">My Profile</span>
        </>
      )}
    </nav>
  )
}
