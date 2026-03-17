/**
 * PromptBuilder — Phase 2.
 *
 * Renders the agent's prompt template with highlighted {{ variable }} tokens
 * replaced by live text inputs. Handles optional addendum text.
 * Calls onSubmit(finalPromptString) when the user is ready.
 */

import { useState, useRef, useEffect } from 'react'
import { Sparkles, ChevronRight } from 'lucide-react'

/** Split a template string into literal + variable token segments. */
function parseTemplate(text) {
  const segments = []
  const re = /\{\{(\w+)\}\}/g
  let lastIndex = 0
  let match
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'literal', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'variable', key: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'literal', value: text.slice(lastIndex) })
  }
  return segments
}

/** Live preview of the assembled prompt. */
function PromptPreview({ segments, values, addendum }) {
  const assembled = segments.map((seg) =>
    seg.type === 'literal' ? seg.value : (values[seg.key] || `[${seg.key}]`)
  ).join('') + (addendum ? `\n\n${addendum}` : '')

  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-medium">Prompt preview</p>
      <p className="text-slate-200 text-sm leading-relaxed font-mono whitespace-pre-wrap">{assembled}</p>
    </div>
  )
}

export default function PromptBuilder({ agent, onSubmit }) {
  const { template } = agent
  const segments = parseTemplate(template.text)

  // Initialise values map from variable definitions
  const [values, setValues] = useState(
    () => Object.fromEntries(template.variables.map((v) => [v.key, '']))
  )
  const [addendum, setAddendum] = useState('')
  const [errors, setErrors] = useState({})
  const firstInputRef = useRef(null)

  useEffect(() => { firstInputRef.current?.focus() }, [])

  const setValue = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }))
    if (val.trim()) setErrors((prev) => { const e = { ...prev }; delete e[key]; return e })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const newErrors = {}
    template.variables.forEach((v) => {
      if (v.required && !values[v.key].trim()) newErrors[v.key] = 'This field is required'
    })
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }

    // Assemble final prompt
    const prompt = segments.map((seg) =>
      seg.type === 'literal' ? seg.value : values[seg.key].trim()
    ).join('') + (addendum.trim() ? `\n\n${addendum.trim()}` : '')

    onSubmit(prompt)
  }

  return (
    <div className="max-w-2xl">
      {/* Visual template display */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wider">Prompt Template</h3>
        </div>

        {/* Inline template display with token highlights */}
        <div className="flex flex-wrap items-baseline gap-1 text-base text-slate-700 leading-relaxed mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200 font-medium">
          {segments.map((seg, i) =>
            seg.type === 'literal' ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <span
                key={i}
                className="inline-block bg-blue-100 text-blue-700 rounded-lg px-2 py-0.5 text-sm font-semibold border border-blue-200"
              >
                {values[seg.key] || `{{ ${seg.key} }}`}
              </span>
            )
          )}
        </div>

        {/* Variable inputs */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {template.variables.map((v, i) => (
            <div key={v.key}>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {v.label}
                {v.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                ref={i === 0 ? firstInputRef : undefined}
                type="text"
                value={values[v.key]}
                onChange={(e) => setValue(v.key, e.target.value)}
                placeholder={v.placeholder}
                className={`
                  w-full rounded-xl border px-4 py-2.5 text-sm text-slate-800 outline-none transition-all
                  placeholder-slate-400 bg-white
                  ${errors[v.key]
                    ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
                    : 'border-slate-300 focus:ring-2 focus:ring-blue-100 focus:border-blue-400'}
                `}
              />
              {errors[v.key] && (
                <p className="text-xs text-red-500 mt-1">{errors[v.key]}</p>
              )}
            </div>
          ))}

          {/* Optional addendum */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {template.addendumLabel}
            </label>
            <textarea
              value={addendum}
              onChange={(e) => setAddendum(e.target.value)}
              placeholder={template.addendumPlaceholder}
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 outline-none
                focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder-slate-400 resize-none"
            />
          </div>

          {/* Preview */}
          <PromptPreview segments={segments} values={values} addendum={addendum} />

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold
              rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm text-sm"
          >
            Run Agent
            <ChevronRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
