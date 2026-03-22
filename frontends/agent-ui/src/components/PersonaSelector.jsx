/**
 * PersonaSelector — Dev-only persona switcher.
 *
 * Renders a compact dropdown in the sidebar that lets developers switch the
 * test persona used for brief requests. Hidden in production (403 from backend).
 *
 * Extracted from App.jsx — this is a fully autonomous component that
 * manages its own API calls and local state.
 */

import { useState, useCallback, useEffect } from 'react'
import { FlaskConical } from 'lucide-react'
import { fetchPersonaToken, fetchPersonas } from '../api/apiClient.js'

const PERSONA_BADGE_COLOURS = {
  manager:    'bg-purple-900/50 text-purple-300 border-purple-700',
  senior_rm:  'bg-blue-900/50   text-blue-300   border-blue-700',
  rm:         'bg-teal-900/50   text-teal-300   border-teal-700',
  readonly:   'bg-slate-700/50  text-slate-400  border-slate-600',
}

export default function PersonaSelector({ onPersonaChange }) {
  const [personas,         setPersonas]         = useState([])
  const [selectedPersona,  setSelectedPersona]  = useState('manager')
  const [status,           setStatus]           = useState('idle')

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
    fetchPersonaToken('manager')
      .then(({ access_token }) => onPersonaChange('manager', access_token))
      .catch(() => onPersonaChange(null, null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personas.length])

  if (personas.length === 0) return null

  const info = personas.find((p) => p.name === selectedPersona)

  return (
    <div>
      <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2 px-1 flex items-center gap-1.5">
        <FlaskConical className="w-3 h-3" />
        Test Persona
      </p>
      <div className="bg-slate-800/70 rounded-xl p-3 space-y-2">
        <div className="relative">
          <label htmlFor="persona-select" className="sr-only">Select test persona</label>
          <select
            id="persona-select"
            value={selectedPersona}
            onChange={handleChange}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 pr-6
              border border-slate-600 focus:border-blue-500 outline-none appearance-none cursor-pointer"
          >
            {personas.map((p) => (
              <option key={p.name} value={p.name}>{p.name} — {p.role}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden="true">▾</span>
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
            <span className="text-xs text-slate-500 animate-pulse">Signing JWT\u2026</span>
          )}
          {status === 'ok' && (
            <span className="text-xs text-emerald-500">\u2713 JWT ready</span>
          )}
          {status === 'error' && (
            <span className="text-xs text-red-400">Token error</span>
          )}
        </div>
      </div>
    </div>
  )
}
