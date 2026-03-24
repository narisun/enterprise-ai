/**
 * ArtifactCard — Inline downloadable document card for agent outputs.
 *
 * When an agent produces a brief or report, it renders as a visually
 * distinct artifact card — similar to how Claude renders code artifacts
 * or ChatGPT renders canvas outputs. The card shows:
 *
 *   • Document icon and title
 *   • Agent attribution
 *   • Preview snippet (first ~200 chars)
 *   • Expand/collapse toggle for full content
 *   • Copy + download actions
 *
 * This separates "the document" from "the conversation" visually,
 * making it clear when the agent has produced a deliverable.
 */

import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import {
  FileText, Copy, Check, Download, ChevronDown, ChevronUp, Maximize2, Minimize2,
} from 'lucide-react'

import { MD_COMPONENTS } from '../lib/markdownRenderers.jsx'

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = useCallback(async () => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5
        rounded-lg hover:bg-slate-100 transition-colors"
      aria-label={copied ? 'Copied' : 'Copy'}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function DownloadBtn({ text, filename }) {
  const handle = useCallback(() => {
    if (!text) return
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }, [text, filename])

  return (
    <button
      onClick={handle}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5
        rounded-lg hover:bg-slate-100 transition-colors"
      aria-label="Download"
    >
      <Download className="w-3.5 h-3.5" />
      Download
    </button>
  )
}

/**
 * Extracts a title from markdown content.
 * Looks for the first H1 or H2 heading, falls back to first line.
 */
function extractTitle(markdown) {
  if (!markdown) return 'Document'
  const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = markdown.split('\n').find((l) => l.trim())
  if (firstLine && firstLine.length < 80) return firstLine.replace(/^#+\s*/, '').trim()
  return 'Document'
}

/**
 * Creates a text preview from markdown by stripping formatting.
 */
function createPreview(markdown, maxLen = 180) {
  if (!markdown) return ''
  const plain = markdown
    .replace(/#{1,6}\s+/g, '')       // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')     // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[`~]/g, '')             // code markers
    .replace(/\n{2,}/g, ' \u00B7 ')   // paragraph breaks
    .replace(/\n/g, ' ')             // line breaks
    .trim()
  return plain.length > maxLen ? plain.slice(0, maxLen) + '\u2026' : plain
}

export default function ArtifactCard({
  content,
  agentName,
  agentIcon,
  clientName,
  filename = 'document.md',
}) {
  const [expanded, setExpanded] = useState(false)
  const title = extractTitle(content)
  const preview = createPreview(content)

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-fade-in">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-50 to-slate-50 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
          <FileText className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{title}</p>
          <p className="text-xs text-slate-400">
            {agentIcon && <span className="mr-1">{agentIcon}</span>}
            {agentName ?? 'Agent'}
            {clientName && <span> — {clientName}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CopyBtn text={content} />
          <DownloadBtn text={content} filename={filename} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5
              rounded-lg hover:bg-slate-100 transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse document' : 'Expand document'}
          >
            {expanded
              ? <><Minimize2 className="w-3.5 h-3.5" /> Collapse</>
              : <><Maximize2 className="w-3.5 h-3.5" /> Expand</>
            }
          </button>
        </div>
      </div>

      {/* ── Preview / Full content ────────────────────────────────────────── */}
      {expanded ? (
        <div className="px-5 py-4 max-h-[32rem] overflow-y-auto">
          <div className="brief-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors group"
        >
          <p className="text-sm text-slate-500 leading-relaxed line-clamp-3 group-hover:text-slate-700 transition-colors">
            {preview}
          </p>
          <p className="text-xs text-blue-500 mt-2 font-medium flex items-center gap-1">
            <ChevronDown className="w-3 h-3" />
            Click to expand full document
          </p>
        </button>
      )}
    </div>
  )
}
