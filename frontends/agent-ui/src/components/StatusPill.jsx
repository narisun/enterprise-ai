/**
 * StatusPill — Compact status badge with icon + text.
 *
 * Accessibility: uses both color AND icon/text so it works for
 * users with color vision deficiency (WCAG 2.1 AA).
 */

import { Loader2, CheckCircle2, AlertCircle, Circle } from 'lucide-react'

const STATUS_CONFIG = {
  streaming: {
    dot:   'bg-blue-500 animate-pulse',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    label: 'Running',
    Icon:  Loader2,
    iconClass: 'w-3 h-3 animate-spin',
  },
  complete: {
    dot:   'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Ready',
    Icon:  CheckCircle2,
    iconClass: 'w-3 h-3',
  },
  error: {
    dot:   'bg-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
    label: 'Error',
    Icon:  AlertCircle,
    iconClass: 'w-3 h-3',
  },
  idle: {
    dot:   'bg-slate-400',
    badge: 'bg-slate-50 text-slate-500 border-slate-200',
    label: 'Idle',
    Icon:  Circle,
    iconClass: 'w-3 h-3',
  },
}

export default function StatusPill({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle
  const { Icon } = cfg

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${cfg.badge}`}
      role="status"
      aria-live="polite"
      aria-label={`Agent status: ${cfg.label}`}
    >
      <Icon className={cfg.iconClass} aria-hidden="true" />
      {cfg.label}
    </span>
  )
}
