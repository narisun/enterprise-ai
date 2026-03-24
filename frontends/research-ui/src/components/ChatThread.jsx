import { useRef, useEffect } from 'react'
import { UserMessage } from './UserMessage.jsx'
import { AssistantMessage } from './AssistantMessage.jsx'

export function ChatThread({ messages, isRunning }) {
  const endRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AssistantMessage key={msg.id} message={msg} />
          )
        )}

        {isRunning && messages[messages.length - 1]?.status !== 'streaming' && (
          <div className="flex items-center gap-2 text-sm text-slate-400 animate-fade-in">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" style={{ animationDelay: '300ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" style={{ animationDelay: '600ms' }} />
            </span>
            Thinking...
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  )
}
