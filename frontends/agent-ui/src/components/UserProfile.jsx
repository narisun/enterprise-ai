/**
 * UserProfile.jsx — User profile page for Quantitix.
 *
 * Sections:
 *   Identity         — avatar, display name, job title, department
 *   Contact          — email, phone, office location, LinkedIn
 *   Role & Access    — platform role, compliance clearance, team, book size
 *   Active Session   — session ID, region, persona (dev), last activity
 *   Preferences      — shortcut link to Settings
 *
 * Profile fields that correspond to real app state (rmId, region, settings)
 * are editable and update live. Other fields use local state and are saved
 * to localStorage under 'quantitix-profile'.
 *
 * Props:
 *   rmId          {string}
 *   onRmIdChange  {function}
 *   sessionId     {string}
 *   settings      {object}   — from App settings state
 *   onOpenSettings {function} — navigate to Settings phase
 *   onBack        {function}
 */

import { useState, useCallback } from 'react'
import { Settings, ExternalLink } from 'lucide-react'

// ── Persist helpers ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'quantitix-profile'

export const loadProfile = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch { return {} }
}

const saveProfile = (profile) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)) }
  catch { /* quota / private browsing */ }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 bg-slate-50 border-b border-slate-200">
        <span className="text-base">{icon}</span>
        <h2 className="text-sm font-bold text-slate-700">{title}</h2>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex items-start gap-4 px-5 py-3.5">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-36 shrink-0 pt-1">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function EditableText({ value, onChange, placeholder, maxLength = 80, mono = false }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full text-sm text-slate-800 bg-transparent border-b border-transparent
        hover:border-slate-300 focus:border-blue-400 outline-none pb-0.5 transition-colors
        placeholder-slate-300 ${mono ? 'font-mono' : ''}`}
    />
  )
}

function ReadOnly({ value, mono = false, muted = false }) {
  return (
    <span className={`text-sm ${mono ? 'font-mono' : ''} ${muted ? 'text-slate-400' : 'text-slate-700'}`}>
      {value}
    </span>
  )
}

function Badge({ label, color = 'slate' }) {
  const colors = {
    blue:    'bg-blue-100 text-blue-800 border-blue-200',
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    purple:  'bg-purple-100 text-purple-800 border-purple-200',
    amber:   'bg-amber-100 text-amber-800 border-amber-200',
    rose:    'bg-rose-100 text-rose-800 border-rose-200',
    teal:    'bg-teal-100 text-teal-800 border-teal-200',
    slate:   'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[color] ?? colors.slate}`}>
      {label}
    </span>
  )
}

// Role → display config
const ROLE_CONFIG = {
  manager:   { label: 'RM Manager',  color: 'purple', clearance: 'Full (AML + Compliance)', bookSize: 'Unlimited' },
  senior_rm: { label: 'Senior RM',   color: 'blue',   clearance: 'Standard',                bookSize: 'Up to 50 accounts' },
  rm:        { label: 'Relationship Manager', color: 'teal', clearance: 'Standard',          bookSize: 'Up to 10 accounts' },
  readonly:  { label: 'Read-Only',   color: 'slate',  clearance: 'Read-only',               bookSize: 'View only' },
}

// Avatar initials + colour from name
function getAvatarConfig(name) {
  const clean = (name || 'RM').trim()
  const initials = clean.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'RM'
  const colours = ['from-blue-500 to-blue-700', 'from-violet-500 to-violet-700',
    'from-emerald-500 to-emerald-700', 'from-rose-500 to-rose-700',
    'from-amber-500 to-amber-700', 'from-teal-500 to-teal-700']
  const idx = [...clean].reduce((a, c) => a + c.charCodeAt(0), 0) % colours.length
  return { initials, gradient: colours[idx] }
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function UserProfile({ rmId, onRmIdChange, sessionId, settings, onOpenSettings, onBack }) {

  // Local profile fields — persisted to localStorage
  const [profile, setProfile] = useState(() => ({
    title:     '',
    department:'',
    email:     '',
    phone:     '',
    location:  '',
    linkedin:  '',
    team:      '',
    ...loadProfile(),
  }))

  const updateField = useCallback((key, value) => {
    setProfile((prev) => {
      const next = { ...prev, [key]: value }
      saveProfile(next)
      return next
    })
  }, [])

  const { initials, gradient } = getAvatarConfig(rmId)
  const roleKey  = settings?.personaName ?? 'rm'
  const roleCfg  = ROLE_CONFIG[roleKey] ?? ROLE_CONFIG.rm
  const region   = settings?.region ?? 'EMEA'

  const now = new Date()
  const sessionStartDisplay = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex h-full overflow-hidden bg-white">

      {/* ── Left panel: avatar card ─────────────────────────────────────── */}
      <div className="w-56 shrink-0 border-r border-slate-200 flex flex-col items-center py-8 px-5 gap-5 bg-slate-50">

        {/* Avatar */}
        <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${gradient}
          flex items-center justify-center text-white text-2xl font-bold shadow-md`}>
          {initials}
        </div>

        {/* Name + title */}
        <div className="text-center">
          <p className="font-bold text-slate-900 text-base leading-tight">{rmId || 'Your Name'}</p>
          <p className="text-xs text-slate-500 mt-1 leading-snug">
            {profile.title || 'Relationship Manager'}
          </p>
          {profile.department && (
            <p className="text-xs text-slate-400 mt-0.5">{profile.department}</p>
          )}
        </div>

        {/* Role badge */}
        <Badge label={roleCfg.label} color={roleCfg.color} />

        {/* Divider */}
        <div className="w-full h-px bg-slate-200" />

        {/* Quick stats */}
        <div className="w-full space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Region</span>
            <span className="font-semibold text-slate-700">{region}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Clearance</span>
            <span className="font-semibold text-slate-700 text-right leading-tight" style={{ maxWidth: '90px' }}>
              {roleCfg.clearance}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Book size</span>
            <span className="font-semibold text-slate-700 text-right leading-tight" style={{ maxWidth: '90px' }}>
              {roleCfg.bookSize}
            </span>
          </div>
        </div>

        {/* Settings shortcut */}
        <button
          onClick={onOpenSettings}
          className="mt-auto w-full flex items-center justify-center gap-2 text-xs text-slate-500
            hover:text-slate-800 border border-slate-200 hover:border-slate-400 rounded-lg py-2 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Preferences
        </button>
      </div>

      {/* ── Right: profile detail ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Sticky header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-8 py-4 flex items-center gap-4 z-10">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors group"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <div>
            <h1 className="text-base font-bold text-slate-900">My Profile</h1>
            <p className="text-xs text-slate-500">Editable fields save automatically</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-7 max-w-2xl space-y-6">

          {/* ── Identity ──────────────────────────────────────────────── */}
          <SectionCard title="Identity" icon="👤">
            <Field label="Display name">
              <EditableText
                value={rmId}
                onChange={onRmIdChange}
                placeholder="Your full name"
              />
              <p className="text-[10px] text-slate-400 mt-0.5">
                Shown in the sidebar and passed as rm_id to all agents
              </p>
            </Field>
            <Field label="Job title">
              <EditableText
                value={profile.title}
                onChange={(v) => updateField('title', v)}
                placeholder="e.g. Senior Relationship Manager"
              />
            </Field>
            <Field label="Department">
              <EditableText
                value={profile.department}
                onChange={(v) => updateField('department', v)}
                placeholder="e.g. Corporate & Institutional Banking"
              />
            </Field>
            <Field label="Team">
              <EditableText
                value={profile.team}
                onChange={(v) => updateField('team', v)}
                placeholder="e.g. Large Corporate EMEA"
              />
            </Field>
          </SectionCard>

          {/* ── Contact ───────────────────────────────────────────────── */}
          <SectionCard title="Contact" icon="📬">
            <Field label="Email">
              <EditableText
                value={profile.email}
                onChange={(v) => updateField('email', v)}
                placeholder="name@yourbank.com"
              />
            </Field>
            <Field label="Phone">
              <EditableText
                value={profile.phone}
                onChange={(v) => updateField('phone', v)}
                placeholder="+44 20 7000 0000"
              />
            </Field>
            <Field label="Office">
              <EditableText
                value={profile.location}
                onChange={(v) => updateField('location', v)}
                placeholder="e.g. London, Canary Wharf"
              />
            </Field>
            <Field label="LinkedIn">
              <div className="flex items-center gap-2">
                <EditableText
                  value={profile.linkedin}
                  onChange={(v) => updateField('linkedin', v)}
                  placeholder="linkedin.com/in/yourprofile"
                />
                {profile.linkedin && (
                  <a
                    href={profile.linkedin.startsWith('http') ? profile.linkedin : `https://${profile.linkedin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700 shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </Field>
          </SectionCard>

          {/* ── Role & Access ──────────────────────────────────────────── */}
          <SectionCard title="Role & Access" icon="🔐">
            <Field label="Platform role">
              <div className="flex items-center gap-2">
                <Badge label={roleCfg.label} color={roleCfg.color} />
                <span className="text-xs text-slate-400">(set via test persona in dev)</span>
              </div>
            </Field>
            <Field label="Compliance">
              <ReadOnly value={roleCfg.clearance} />
            </Field>
            <Field label="Book size">
              <ReadOnly value={roleCfg.bookSize} />
            </Field>
            <Field label="Region">
              <ReadOnly value={region} />
            </Field>
            <Field label="OPA policies">
              <div className="flex flex-wrap gap-1.5">
                {['tool_auth.rego', 'rm_prep_authz.rego'].map((p) => (
                  <span key={p} className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                    {p}
                  </span>
                ))}
              </div>
            </Field>
            <Field label="MCP access">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: 'salesforce-mcp', port: 8081 },
                  { name: 'payments-mcp',   port: 8082 },
                  { name: 'news-search-mcp',port: 8083 },
                ].map(({ name, port }) => (
                  <span key={name} className="font-mono text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
                    {name} :{port}
                  </span>
                ))}
              </div>
            </Field>
          </SectionCard>

          {/* ── Active Session ─────────────────────────────────────────── */}
          <SectionCard title="Active Session" icon="⚡">
            <Field label="Session ID">
              <ReadOnly value={sessionId} mono muted />
            </Field>
            <Field label="Started">
              <ReadOnly value={sessionStartDisplay} />
            </Field>
            <Field label="Region">
              <ReadOnly value={region} />
            </Field>
            <Field label="Storage">
              <div className="flex items-center gap-2">
                <ReadOnly value="sessionStorage (browser)" />
                <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded font-semibold">
                  Tab-scoped
                </span>
              </div>
            </Field>
            <Field label="Auth">
              <ReadOnly value="RS256 JWT · AgentContext HMAC-SHA256" mono />
            </Field>
          </SectionCard>

          {/* ── Preferences shortcut ───────────────────────────────────── */}
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center justify-between px-5 py-4 border border-slate-200
              rounded-xl hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">⚙️</span>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">
                  Preferences & Settings
                </p>
                <p className="text-xs text-slate-500">
                  Card layout, data defaults, display density, and more
                </p>
              </div>
            </div>
            <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div className="h-4" />
        </div>
      </div>
    </div>
  )
}
