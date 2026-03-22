/**
 * OutputCanvas — Full-width response canvas with professional streaming UX.
 *
 * ── Design principles (matching Claude / ChatGPT / Gemini) ──────────────
 *
 *  1. THINKING PHASE — Collapsed-by-default activity indicator that shows
 *     a live one-line preview. User can expand to see full timeline.
 *     Activity shimmer communicates "working" without being distracting.
 *
 *  2. STREAMING PHASE — Token-by-token markdown rendering with a subtle
 *     blinking cursor. Auto-scrolls to follow new content. Smooth
 *     transition when final output replaces the stream.
 *
 *  3. COMPLETE PHASE — Clean output with toolbar (copy, download).
 *     Refinement bar with suggested follow-ups. ThinkingBlock stays
 *     collapsed but expandable for transparency.
 *
 *  4. ERROR PHASE — Classified error with retry button and partial
 *     output preservation when possible.
 *
 * Props:
 *   output        — string | null     — final authoritative markdown
 *   streamingText — string            — live token buffer
 *   clientName    — string | null     — extracted client name (RM Prep)
 *   status        — 'streaming' | 'complete' | 'error' | 'idle'
 *   error         — string | null
 *   onRefine      — (prompt: string) => void
 *   onRetry       — () => void
 *   agent         — agent display config
 *   steps, activeStep, thoughts, thinkingText, thinkingLog, toolCalls
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import {
  Copy, Download, Check, RefreshCw, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react'

import { MD_COMPONENTS } from '../lib/markdownRenderers.jsx'
import ThinkingBlock from './ThinkingBlock.jsx'
import RefinementBar from './RefinementBar.jsx'

// ── Copy button ───────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      onClick={handle}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ── Download button ───────────────────────────────────────────────────────
function DownloadButton({ text, filename }) {
  const handle = useCallback(() => {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }, [text, filename])

  return (
    <button
      onClick={handle}
      aria-label="Download as markdown file"
      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      Download .md
    </button>
  )
}

// ── Error classification ──────────────────────────────────────────────────
function classifyError(errorMsg) {
  if (!errorMsg) return { type: 'unknown', title: 'Something went wrong', suggestion: 'Try again or rephrase your request.' }
  const msg = errorMsg.toLowerCase()
  if (msg.includes('401') || msg.includes('unauthorized'))
    return { type: 'auth', title: 'Authentication Error', suggestion: 'Your API key may be invalid or expired. Check your .env configuration.' }
  if (msg.includes('timeout') || msg.includes('timed out'))
    return { type: 'timeout', title: 'Request Timed Out', suggestion: 'The agent took too long to respond. Try a simpler request or check if the backend is running.' }
  if (msg.includes('500') || msg.includes('internal server'))
    return { type: 'server', title: 'Server Error', suggestion: 'The backend encountered an error. Check the agent logs for details.' }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed'))
    return { type: 'network', title: 'Connection Error', suggestion: 'Could not reach the backend. Check your network connection and that the agent service is running.' }
  return { type: 'unknown', title: 'Agent Error', suggestion: 'Try rephrasing your request or check the agent logs.' }
}

// ── Error Card ────────────────────────────────────────────────────────────
function ErrorCard({ error, onRetry }) {
  const classified = classifyError(error)
  const IconComponent = classified.type === 'network' ? WifiOff : AlertTriangle

  return (
    <div className="rounded-xl bg-red-50 border border-red-200 p-5 max-w-lg mt-2 animate-fade-in">
      <div className="flex items-start gap-3">
        <IconComponent className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-red-700 text-sm mb-1">{classified.title}</p>
          <p className="text-sm text-red-600 mb-1">{error ?? 'An unexpected error occurred.'}</p>
          <p className="text-xs text-red-500 mb-3">{classified.suggestion}</p>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800
              bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Streaming cursor (blinking line like Claude/ChatGPT) ──────────────────
function StreamingCursor() {
  return (
    <span className="streaming-cursor inline-block w-0.5 h-[1.1em] bg-blue-500 ml-0.5 align-text-bottom rounded-sm" />
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function OutputCanvas({
  output, streamingText = '', clientName, status, error, onRefine, onRetry, agent,
  steps = [], activeStep = null, thoughts = [],
  thinkingText = null, thinkingLog = [], toolCalls = [],
}) {
  const canvasRef  = useRef(null)
  const hasOutput  = !!output
  const hasTokens  = !!streamingText
  const isRefining = status === 'streaming' && hasOutput
  const isDone     = status === 'complete'

  // Scroll to top when completed response arrives
  useEffect(() => {
    if (isDone && canvasRef.current) {
      canvasRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [isDone, output])

  // Auto-scroll to follow streaming tokens
  const streamingBottomRef = useRef(null)
  useEffect(() => {
    if (hasTokens && !hasOutput) {
      streamingBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streamingText, hasTokens, hasOutput])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">

      {/* ── Toolbar — visible when output is ready ───────────────────────── */}
      {hasOutput && (
        <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 backdrop-blur-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-lg">{agent?.icon}</span>
            <span className="text-sm font-semibold text-slate-700">
              {clientName ? `Brief \u2014 ${clientName}` : `${agent?.workerName ?? 'Worker'} \u00B7 Output`}
            </span>
            {isDone && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Ready</span>
            )}
            {isRefining && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium animate-pulse">
                Updating\u2026
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <CopyButton text={output} />
            <DownloadButton
              text={output}
              filename={`${(agent?.id ?? 'output')}-${(clientName ?? 'report').replace(/\s+/g, '-').toLowerCase()}.md`}
            />
          </div>
        </div>
      )}

      {/* ── Scrollable canvas ──────────────────────────────────────────── */}
      <div ref={canvasRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">

        {/* ── Idle state ───────────────────────────────────────────────── */}
        {status === 'idle' && !hasOutput && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 animate-fade-in">
            <span className="text-4xl mb-3">{agent?.icon ?? '\uD83D\uDCCB'}</span>
            <p className="text-sm font-medium text-slate-500">{agent?.workerName ?? 'The agent'} is ready</p>
            <p className="text-xs mt-1">Output will appear here once you submit a request.</p>
          </div>
        )}

        {/* ── Initial loading (before any events arrive) ───────────────── */}
        {status === 'streaming' && !hasTokens && !steps.length && !activeStep && !thinkingText && (
          <div className="flex items-center gap-3 text-slate-500 mb-5 animate-fade-in">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-sm font-medium">{agent?.workerName ?? 'Agent'} is starting up\u2026</span>
          </div>
        )}

        {/* ── ThinkingBlock — collapsed activity timeline ───────────────── */}
        <ThinkingBlock
          steps={steps}
          activeStep={activeStep}
          thoughts={thoughts}
          agent={agent}
          status={status}
          hasTokens={hasTokens || hasOutput}
          thinkingText={thinkingText}
          thinkingLog={thinkingLog}
          toolCalls={toolCalls}
        />

        {/* ── Live token stream ─────────────────────────────────────────── */}
        {hasTokens && !hasOutput && (
          <div className="max-w-3xl animate-fade-in">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MD_COMPONENTS}
            >
              {streamingText}
            </ReactMarkdown>
            <StreamingCursor />
            <div ref={streamingBottomRef} />
          </div>
        )}

        {/* ── Error state — classified with retry ──────────────────────── */}
        {status === 'error' && (
          <>
            {/* Show partial output if we had some streaming text */}
            {hasTokens && (
              <div className="max-w-3xl mb-4 opacity-60">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={MD_COMPONENTS}
                >
                  {streamingText}
                </ReactMarkdown>
              </div>
            )}
            <ErrorCard error={error} onRetry={onRetry} />
          </>
        )}

        {/* ── Final output ──────────────────────────────────────────────── */}
        {hasOutput && (
          <div className="max-w-3xl animate-fade-in">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MD_COMPONENTS}
            >
              {output}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* ── Refinement bar ──────────────────────────────────────────────── */}
      {(isDone || status === 'error' || isRefining) && (
        <RefinementBar
          onSubmit={onRefine}
          isRefining={isRefining}
          suggestions={isDone ? agent?.followUps?.slice(0, 3) : []}
        />
      )}
    </div>
  )
}
