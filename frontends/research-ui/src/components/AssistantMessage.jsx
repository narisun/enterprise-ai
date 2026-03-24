import { Bot, AlertCircle } from 'lucide-react'
import { PlanViewer } from './PlanViewer.jsx'
import { ToolCallCard } from './ToolCallCard.jsx'
import { SubagentCard } from './SubagentCard.jsx'
import { ArtifactCard } from './ArtifactCard.jsx'
import { MarkdownRenderer } from './MarkdownRenderer.jsx'

export function AssistantMessage({ message }) {
  const { content, plan, toolCalls, subagents, artifacts, thinking, status, error } = message
  const isStreaming = status === 'streaming'
  const isError = status === 'error'

  return (
    <div className="flex gap-3 animate-fade-in">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1">
        <div className="w-7 h-7 rounded-lg bg-slate-800 text-white flex items-center justify-center">
          <Bot size={14} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Plan section */}
        {plan && <PlanViewer plan={plan} />}

        {/* Thinking indicator */}
        {isStreaming && thinking && (
          <div className="text-xs text-slate-400 italic flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
            {thinking}
          </div>
        )}

        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div className="space-y-2">
            {toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Subagents */}
        {subagents.length > 0 && (
          <div className="space-y-2">
            {subagents.map((sa) => (
              <SubagentCard key={sa.id} subagent={sa} />
            ))}
          </div>
        )}

        {/* Main response text */}
        {content && (
          <div className={`prose prose-sm prose-slate max-w-none ${isStreaming ? 'streaming-cursor' : ''}`}>
            <MarkdownRenderer content={content} />
          </div>
        )}

        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div className="space-y-2">
            {artifacts.map((art) => (
              <ArtifactCard key={art.id} artifact={art} />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
