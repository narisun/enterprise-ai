/**
 * DataSourceDetail.jsx
 *
 * Full detail page for a data source. Shown when the user clicks a data source
 * chip on an agent card, a sidebar item, or a data source badge in ExecutionRail.
 *
 * Props:
 *   sourceId  {string}   — ID matching a key in dataSources.js
 *   onBack    {function} — called when the user clicks the back button
 */

import { getDataSource, getSourcesForAgent } from '../config/dataSources.js'
import { AGENTS } from '../config/agents.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const isLive = status === 'live'
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        isLive
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-400'}`}
      />
      {isLive ? 'Live' : 'Coming Soon'}
    </span>
  )
}

function TransportBadge({ transport }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
      {transport}
    </span>
  )
}

function ColumnRow({ col }) {
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-2.5 px-3 align-top">
        <div className="flex items-center gap-1.5">
          <code className="text-xs font-mono text-gray-900 font-semibold">
            {col.name}
          </code>
          {col.opaMasked && (
            <span
              title="OPA-masked: redacted at standard clearance"
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 leading-none"
            >
              OPA
            </span>
          )}
          {col.sensitive && !col.opaMasked && (
            <span
              title="Sensitive PII field"
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 leading-none"
            >
              PII
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <code className="text-xs font-mono text-indigo-700">{col.type}</code>
      </td>
      <td className="py-2.5 px-3 align-top text-xs text-gray-600 leading-relaxed">
        {col.description}
        {col.opaMasked && (
          <span className="block mt-0.5 text-rose-600 font-medium text-[10px]">
            Requires compliance_clearance ≥ aml
          </span>
        )}
      </td>
    </tr>
  )
}

function SchemaTable({ table }) {
  return (
    <div className="mb-6">
      <div className="flex items-start gap-3 mb-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 font-mono">
            {table.name}
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">{table.description}</p>
        </div>
      </div>
      {table.columns && table.columns.length > 0 ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-40">
                  Column
                </th>
                <th className="py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">
                  Type
                </th>
                <th className="py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <ColumnRow key={col.name} col={col} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DataSourceDetail({ sourceId, onBack }) {
  const source = getDataSource(sourceId)

  if (!source) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
        <span className="text-4xl">⚠️</span>
        <p className="text-sm">Data source not found: {sourceId}</p>
        <button
          onClick={onBack}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Go back
        </button>
      </div>
    )
  }

  // Agents that use this source (from AGENTS config, not just usedBy list)
  const usingAgents = AGENTS.filter((a) =>
    a.dataSources?.some((ds) => ds.sourceId === sourceId)
  )

  const hasMaskedCols = source.schema?.some((t) =>
    t.columns?.some((c) => c.opaMasked)
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex-none border-b border-gray-200 bg-white px-6 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-3 group"
        >
          <svg
            className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex items-start gap-4">
          <div className="text-4xl leading-none mt-0.5">{source.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">{source.label}</h2>
              <StatusBadge status={source.status} />
              <TransportBadge transport={source.transport} />
            </div>
            <p className="text-sm text-gray-500 mt-1">
              MCP server:{' '}
              <code className="font-mono text-gray-700">{source.mcpServer}</code>
              {' '}·{' '}
              port{' '}
              <code className="font-mono text-gray-700">{source.port}</code>
            </p>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

        {/* Description */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
            Overview
          </h3>
          <p className="text-sm text-gray-700 leading-relaxed">{source.description}</p>
        </section>

        {/* Access control */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
            Access Control
          </h3>
          <div className="flex gap-2.5 items-start bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
            <span className="text-base mt-0.5">🔐</span>
            <p className="text-sm text-blue-900 leading-relaxed">{source.accessNote}</p>
          </div>

          {hasMaskedCols && (
            <div className="flex gap-2.5 items-start bg-rose-50 border border-rose-100 rounded-lg px-4 py-3 mt-2">
              <span className="text-base mt-0.5">🚫</span>
              <div>
                <p className="text-sm font-semibold text-rose-800 mb-0.5">OPA column masking active</p>
                <p className="text-xs text-rose-700 leading-relaxed">
                  Columns marked <span className="font-bold">OPA</span> are redacted at runtime for callers
                  with <code className="font-mono">compliance_clearance = standard</code>.
                  They are visible only when clearance is <code className="font-mono">aml</code> or <code className="font-mono">full</code>.
                  The OPA policy <code className="font-mono">rm_prep_authz.rego</code> enforces this at the MCP tool layer — the data never leaves the server unmasked.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Schema */}
        {source.schema && source.schema.length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              Schema
            </h3>
            {source.schema.map((table) => (
              <SchemaTable key={table.name} table={table} />
            ))}
          </section>
        ) : source.status === 'coming-soon' ? (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
              Schema
            </h3>
            <div className="border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center">
              <p className="text-sm text-gray-400">
                Schema details will be published when this data source is activated.
              </p>
            </div>
          </section>
        ) : null}

        {/* Used by agents */}
        {usingAgents.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              Used by
            </h3>
            <div className="flex flex-wrap gap-2">
              {usingAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg"
                >
                  <span className="text-base">{agent.icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{agent.workerName}</p>
                    <p className="text-[10px] text-gray-500">{agent.workerRole}</p>
                  </div>
                  {agent.comingSoon && (
                    <span className="text-[10px] text-amber-600 font-semibold ml-1">Soon</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Connection details */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Connection Details
          </h3>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <tbody>
                {[
                  { label: 'MCP Server',  value: source.mcpServer },
                  { label: 'Port',        value: source.port },
                  { label: 'Transport',   value: source.transport },
                  { label: 'Status',      value: source.status === 'live' ? 'Active' : 'Not yet deployed' },
                  { label: 'SSE Endpoint',
                    value: source.status === 'live'
                      ? `http://localhost:${source.port}/sse`
                      : 'N/A' },
                ].map(({ label, value }) => (
                  <tr key={label} className="border-t border-gray-100 first:border-t-0">
                    <td className="py-2.5 px-4 text-xs font-semibold text-gray-500 w-40 bg-gray-50">
                      {label}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-mono text-gray-800">
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  )
}
