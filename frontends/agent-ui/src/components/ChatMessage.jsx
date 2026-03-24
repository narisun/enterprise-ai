/**
 * ChatMessage — Renders a single message bubble (user or assistant).
 *
 * User messages: Right-aligned, blue background, plain text.
 * Assistant messages: Left-aligned with:
 *   • Embedded ThinkingBlock (collapsible activity timeline)
 *   • ArtifactCard for completed briefs/reports (Phase 4)
 *   • Streaming markdown with cursor for live responses
 *   • Error card with retry for failed responses
 *
 * Handles both completed messages (from history) and the live
 * streaming message (via liveStream prop).
 */

import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import {
  RefreshCw, AlertTriangle, WifiOff, User, Bot,
} from 'lucide-react'

import { MD_COMPONENTS } from '../lib/markdownRenderers.jsx'
import ThinkingBlock from './ThinkingBlock.jsx'
import ArtifactCard from './ArtifactCard.jsx'
import { getAgent } from '../config/agents.js'

// ── Error classification ──────────────────────────────────────────────────
function classifyError(errorMsg) {
  if (!errorMsg) return { type: 'unknown', title: 'Something went wrong', suggestion: 'Try again or rephrase.' }
  const msg = errorMsg.toLowerCase()
  if (msg.includes('401') || msg.includes('unauthorized'))
    return { type: 'auth', title: 'Authentication Error', suggestion: 'Check your API key.' }
  if (msg.includes('timeout') || msg.includes('timed out'))
    return { type: 'timeout', title: 'Request Timed Out', suggestion: 'Try a simpler request.' }
  if (msg.includes('500') || msg.includes('internal server'))
    return { type: 'server', title: 'Server Error', suggestion: 'Check the agent logs.' }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed'))
    return { type: 'network', title: 'Connection Error', suggestion: 'Check the backend is running.' }
  return { type: 'unknown', title: 'Agent Error', suggestion: 'Try rephrasing your request.' }
}

// ── Streaming cursor ──────────────────────────────────────────────────────
function StreamingCursor() {
  return (
    <span
      className="streaming-cursor inline-block w-0.5 h-[1.1em] bg-blue-500 ml-0.5 align-text-bottom rounded-sm"
      aria-hidden="true"
    />
  )
}

/**
 * Determine if output is substantial enough to render as an artifact card.
 * Short responses (< 300 chars or < 3 lines) render inline.
 * Briefs and reports with headings render as artifact cards.
 */
function shouldRenderAsArtifact(content) {
  if (!content) return false
  if (content.length < 300) return false
  // Must have at least one heading to look like a structured document
  if (!/^#{1,3}\s+/m.test(content)) return false
  // Must have multiple sections
  const headingCount = (content.match(/^#{1,3}\s+/gm) || []).length
  return headingCount >= 2
}

// ── User message ──────────────────────────────────────────────────────────
function UserBubble({ content }) {
  return (
    <div className="flex justify-end gap-3 animate-fade-in">
      <div className="max-w-2xl">
        <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-1">
        <User className="w-4 h-4 text-blue-600" />
      </div>
    </div>
  )
}

// ── Assistant message ─────────────────────────────────────────────────────
function AssistantBubble({
  message = null,
  liveStream = null,
  agent = null,
  onRetry,
  isLive = false,
}) {
  // Resolve state from saved message or live stream
  const status = isLive ? liveStream?.status : message?.status
  const content = isLive
    ? (liveStream?.output ?? liveStream?.streamingText ?? '')
    : (message?.content ?? '')
  const error = isLive ? liveStream?.error : message?.error
  const steps = isLive ? liveStream?.steps : message?.steps
  const activeStep = isLive ? liveStream?.activeStep : null
  const toolCalls = isLive ? liveStream?.toolCalls : message?.toolCalls
  const thinkingLog = isLive ? liveStream?.thinkingLog : message?.thinkingLog
  const thinkingText = isLive ? liveStream?.thinkingText : null
  const thoughts = isLive ? liveStream?.thoughts : message?.thoughts
  const clientName = isLive ? liveStream?.clientName : message?.clientName
  const agentId = isLive ? null : message?.agentId

  const resolvedAgent = agent ?? (agentId ? getAgent(agentId) : null)
  const isStreamingContent = isLive && status === 'streaming'
  const hasOutput = isLive ? !!liveStream?.output : !!content
  const hasTokens = isLive ? !!liveStream?.streamingText : false
  const hasThinking = (steps?.length > 0) || !!activeStep || (toolCalls?.length > 0)

  const classified = error ? classifyError(error) : null
  const ErrorIcon = classified?.type === 'network' ? WifiOff : AlertTriangle

  // Decide rendering mode for completed output
  const finalContent = isLive ? liveStream?.output : content
  const renderAsArtifact = hasOutput && shouldRenderAsArtifact(finalContent)

  return (
    <div className="flex gap-3 animate-fade-in">
      {/* Agent avatar */}
      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-1">
        {resolvedAgent
          ? <span className="text-sm">{resolvedAgent.icon}</span>
          : <Bot className="w-4 h-4 text-slate-500" />
        }
      </div>

      <div className="flex-1 min-w-0 max-w-3xl space-y-2">
        {/* Agent name label */}
        {resolvedAgent && (
          <p className="text-xs font-semibold text-slate-500 mb-0.5">
            {resolvedAgent.workerName}
            {clientName && <span className="font-normal text-slate-400"> — {clientName}</span>}
          </p>
        )}

        {/* ThinkingBlock — activity timeline */}
        {hasThinking && (
          <ThinkingBlock
            steps={steps ?? []}
            activeStep={activeStep}
            thoughts={thoughts ?? []}
            agent={resolvedAgent}
            status={isLive ? status : 'complete'}
            hasTokens={hasOutput || hasTokens}
            thinkingText={thinkingText}
            thinkingLog={thinkingLog ?? []}
            toolCalls={toolCalls ?? []}
          />
        )}

        {/* Initial loading — before any content or thinking */}
        {isStreamingContent && !hasTokens && !hasOutput && !hasThinking && (
          <div className="flex items-center gap-2 py-4">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-sm text-slate-400">{resolvedAgent?.workerName ?? 'Agent'} is thinking</span>
          </div>
        )}

        {/* Streaming content (live tokens — always inline) */}
        {isLive && hasTokens && !hasOutput && (
          <div className="bg-white rounded-2xl rounded-tl-md border border-slate-200 px-5 py-4 shadow-sm">
            <div className="brief-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>
                {liveStream.streamingText}
              </ReactMarkdown>
              <StreamingCursor />
            </div>
          </div>
        )}

        {/* Completed output — rendered as artifact card or inline */}
        {hasOutput && renderAsArtifact && (
          <ArtifactCard
            content={finalContent}
            agentName={resolvedAgent?.workerName}
            agentIcon={resolvedAgent?.icon}
            clientName={clientName}
            filename={`${resolvedAgent?.id ?? 'output'}-${(clientName ?? 'document').replace(/\s+/g, '-').toLowerCase()}.md`}
          />
        )}

        {hasOutput && !renderAsArtifact && (
          <div className="bg-white rounded-2xl rounded-tl-md border border-slate-200 px-5 py-4 shadow-sm">
            <div className="brief-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>
                {finalContent}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="flex items-start gap-3">
              <ErrorIcon className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-700 text-sm mb-0.5">{classified.title}</p>
                <p className="text-xs text-red-600 mb-2">{classified.suggestion}</p>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700
                      bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────
export default function ChatMessage(props) {
  if (props.message?.role === 'user') {
    return <UserBubble content={props.message.content} />
  }
  return <AssistantBubble {...props} />
}

export { UserBubble, AssistantBubble }
