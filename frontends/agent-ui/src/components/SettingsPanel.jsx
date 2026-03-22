/**
 * SettingsPanel.jsx — User-configurable settings for the Quantitix platform.
 *
 * This component is PURE UI — it receives settings as props and emits
 * changes via onChange. All persistence logic lives in lib/settings.js.
 *
 * Props:
 *   settings    {object}   — current settings object from useSettings hook
 *   onChange    {function} — called with (key, value) on any change
 *   onBack      {function} — return to the previous phase
 *   rmId        {string}   — current RM display name
 *   onRmIdChange {function} — update RM name in App state
 */

import { useRef } from 'react'
import { DEFAULT_SETTINGS } from '../lib/settings.js'

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <span className="text-2xl mt-0.5">{icon}</span>
      <div>
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function SettingRow({ label, description, children }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex w-10 h-5.5 rounded-full transition-colors duration-200 focus:outline-none
        ${checked ? 'bg-blue-600' : 'bg-slate-300'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ height: '22px', width: '40px' }}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200
          ${checked ? 'translate-x-[18px]' : 'translate-x-0'}`}
        style={{ width: '18px', height: '18px' }}
      />
    </button>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800
        focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 cursor-pointer"
    >
      {options.map(({ value: v, label }) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  )
}

function NumberInput({ value, onChange, min, max, step = 1, suffix }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800
          focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
      />
      {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, maxLength }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-48 text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800
        focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
    />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SettingsPanel({ settings, onChange, onBack, rmId, onRmIdChange }) {

  // Use refs for scroll-to-section (avoids direct DOM ID coupling)
  const sectionRefs = useRef({})
  const scrollToSection = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleReset = () => {
    if (window.confirm('Reset all settings to their defaults?')) {
      Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => onChange(k, v))
      onRmIdChange('RM')
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-white">

      {/* ── Left nav ─────────────────────────────────────────────────── */}
      <nav className="w-52 shrink-0 border-r border-slate-200 overflow-y-auto py-6 px-4 hidden md:block">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-2">
          Sections
        </p>
        <ul className="space-y-0.5">
          {[
            { id: 's-profile',  icon: '👤', label: 'Profile'      },
            { id: 's-display',  icon: '🖥️', label: 'Display'      },
            { id: 's-session',  icon: '🔄', label: 'Session'      },
            { id: 's-data',     icon: '📡', label: 'Data & Search' },
            { id: 's-about',    icon: 'ℹ️', label: 'About'        },
          ].map(({ id, icon, label }) => (
            <li key={id}>
              <button
                onClick={() => scrollToSection(id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors text-left"
              >
                <span>{icon}</span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Sticky header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-8 py-4 flex items-center gap-4 z-10">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-base font-bold text-slate-900">Settings</h1>
            <p className="text-xs text-slate-500">Preferences are saved automatically</p>
          </div>
        </div>

        {/* Settings body */}
        <div className="px-8 py-8 max-w-2xl space-y-12">

          {/* ── Profile ─────────────────────────────────────────────── */}
          <section ref={(el) => { sectionRefs.current['s-profile'] = el }}>
            <SectionHeader
              icon="👤"
              title="Profile"
              subtitle="Your identity as seen by agents and audit logs"
            />
            <div className="border border-slate-200 rounded-xl px-5 divide-y divide-slate-100">
              <SettingRow
                label="Display name"
                description="Shown in the sidebar and passed as rm_id in every agent request."
              >
                <TextInput
                  value={rmId}
                  onChange={onRmIdChange}
                  placeholder="Your name"
                  maxLength={40}
                />
              </SettingRow>

              <SettingRow
                label="Region"
                description="Used to tag sessions in the audit trail. Has no effect on data access."
              >
                <Select
                  value={settings.region}
                  onChange={(v) => onChange('region', v)}
                  options={[
                    { value: 'EMEA',   label: 'EMEA' },
                    { value: 'APAC',   label: 'APAC' },
                    { value: 'AMER',   label: 'Americas' },
                    { value: 'LATAM',  label: 'LATAM' },
                  ]}
                />
              </SettingRow>
            </div>
          </section>

          {/* ── Display ─────────────────────────────────────────────── */}
          <section ref={(el) => { sectionRefs.current['s-display'] = el }}>
            <SectionHeader
              icon="🖥️"
              title="Display"
              subtitle="Control how the agent directory and cards are presented"
            />
            <div className="border border-slate-200 rounded-xl px-5 divide-y divide-slate-100">
              <SettingRow
                label="Card minimum width"
                description="Minimum width of each agent card before the grid wraps to fewer columns. Reduce to fit more cards per row on wider screens."
              >
                <Select
                  value={String(settings.cardMinWidth)}
                  onChange={(v) => onChange('cardMinWidth', Number(v))}
                  options={[
                    { value: '220', label: '220 px — compact' },
                    { value: '260', label: '260 px' },
                    { value: '280', label: '280 px — default' },
                    { value: '320', label: '320 px' },
                    { value: '360', label: '360 px — wide' },
                  ]}
                />
              </SettingRow>

              <SettingRow
                label="Show coming-soon agents"
                description="Display In Development cards in the team directory. Turn off to show only active agents."
              >
                <Toggle
                  checked={settings.showComingSoon}
                  onChange={(v) => onChange('showComingSoon', v)}
                />
              </SettingRow>

              <SettingRow
                label="Card density"
                description="Comfortable adds more padding; compact reduces spacing between elements."
              >
                <Select
                  value={settings.density}
                  onChange={(v) => onChange('density', v)}
                  options={[
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'compact',     label: 'Compact'     },
                  ]}
                />
              </SettingRow>
            </div>
          </section>

          {/* ── Session ─────────────────────────────────────────────── */}
          <section ref={(el) => { sectionRefs.current['s-session'] = el }}>
            <SectionHeader
              icon="🔄"
              title="Session"
              subtitle="How sessions are managed across agent switches"
            />
            <div className="border border-slate-200 rounded-xl px-5 divide-y divide-slate-100">
              <SettingRow
                label="Auto-reset when switching agents"
                description="Automatically start a new session when you select a different agent. When off, the same session ID is reused (only useful for multi-agent workflows)."
              >
                <Toggle
                  checked={settings.autoResetOnSwitch}
                  onChange={(v) => onChange('autoResetOnSwitch', v)}
                />
              </SettingRow>

              <SettingRow
                label="Session storage"
                description="Session IDs are stored in sessionStorage so they survive hot-reloads but not new browser tabs. This is always on in the current build."
              >
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                  Always on
                </span>
              </SettingRow>
            </div>
          </section>

          {/* ── Data & Search ────────────────────────────────────────── */}
          <section ref={(el) => { sectionRefs.current['s-data'] = el }}>
            <SectionHeader
              icon="📡"
              title="Data & Search"
              subtitle="Default parameters passed to MCP tool servers"
            />
            <div className="border border-slate-200 rounded-xl px-5 divide-y divide-slate-100">
              <SettingRow
                label="News lookback"
                description="Default number of days of news the news-search-mcp server will scan. Agents can override this per call."
              >
                <NumberInput
                  value={settings.newsLookbackDays}
                  onChange={(v) => onChange('newsLookbackDays', v)}
                  min={7}
                  max={365}
                  step={1}
                  suffix="days"
                />
              </SettingRow>

              <SettingRow
                label="Max news results"
                description="Maximum number of articles returned per news search query. Higher values increase latency."
              >
                <NumberInput
                  value={settings.maxNewsResults}
                  onChange={(v) => onChange('maxNewsResults', v)}
                  min={5}
                  max={50}
                  step={5}
                  suffix="articles"
                />
              </SettingRow>
            </div>
          </section>

          {/* ── About ────────────────────────────────────────────────── */}
          <section ref={(el) => { sectionRefs.current['s-about'] = el }}>
            <SectionHeader
              icon="ℹ️"
              title="About"
              subtitle="Platform build information"
            />
            <div className="border border-slate-200 rounded-xl px-5 divide-y divide-slate-100">
              {[
                { label: 'Platform',       value: 'Quantitix — Agentic AI' },
                { label: 'UI version',     value: '1.0.0-dev' },
                { label: 'Agent runtime',  value: 'LangGraph 0.2 · Python 3.12' },
                { label: 'MCP transport',  value: 'FastMCP SSE' },
                { label: 'Auth',           value: 'RS256 JWT / Auth0-compatible' },
                { label: 'Policy engine',  value: 'OPA (Open Policy Agent)' },
              ].map(({ label, value }) => (
                <SettingRow key={label} label={label}>
                  <span className="text-sm font-mono text-slate-500">{value}</span>
                </SettingRow>
              ))}

              <div className="py-4">
                <button
                  onClick={handleReset}
                  className="text-sm text-red-600 hover:text-red-700 font-medium hover:underline transition-colors"
                >
                  Reset all settings to defaults
                </button>
                <p className="text-xs text-slate-400 mt-1">
                  This will restore every setting above to its factory value.
                </p>
              </div>
            </div>
          </section>

          {/* Bottom padding */}
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
