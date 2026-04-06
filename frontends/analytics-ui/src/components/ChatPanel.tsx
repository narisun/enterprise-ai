/**
 * ChatPanel — Left sidebar containing message history and input.
 *
 * Displays the conversation thread, streams the current assistant narrative,
 * and provides the input box for new queries.
 */
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Square, BarChart3, Sparkles } from "lucide-react";
import type { ChatMessage, StreamStatus } from "../lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  streamStatus: StreamStatus;
  streamNarrative: string;
  onSend: (message: string) => void;
}

export function ChatPanel({
  messages,
  streamStatus,
  streamNarrative,
  onSend,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamNarrative]);

  const handleSubmit = () => {
    if (!input.trim() || streamStatus === "streaming") return;
    onSend(input);
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isStreaming = streamStatus === "streaming";

  return (
    <div className="flex flex-col h-full bg-gray-950 border-r border-gray-800">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <BarChart3 size={18} className="text-indigo-400" />
        <h2 className="text-sm font-semibold text-gray-200">Analytics Chat</h2>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Sparkles size={32} className="text-indigo-400 mb-3" />
            <p className="text-sm text-gray-400 mb-2">Ask a question about your data</p>
            <div className="space-y-1.5 w-full">
              {[
                "Show me Q3 revenue by region",
                "What's the payment trend for top clients?",
                "Pipeline velocity this quarter",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSend(suggestion)}
                  className="block w-full text-left text-xs text-gray-500 hover:text-indigo-400
                    bg-gray-900 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`animate-fade-in ${msg.role === "user" ? "flex justify-end" : ""}`}>
            <div
              className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-200"
              }`}
            >
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm prose-invert max-w-none">
                  {msg.content}
                </ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* Streaming assistant message */}
        {isStreaming && streamNarrative && (
          <div className="animate-fade-in">
            <div className="max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-gray-800 text-gray-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm prose-invert max-w-none">
                {streamNarrative}
              </ReactMarkdown>
              <span className="streaming-cursor" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-800">
        <div className="flex items-end gap-2 bg-gray-900 rounded-xl border border-gray-700 focus-within:border-indigo-500 transition-colors px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your data..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500
              resize-none outline-none min-h-[24px] max-h-[120px]"
            style={{ height: "auto", overflow: "hidden" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 p-1.5 rounded-lg transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:bg-indigo-600 text-gray-400 hover:text-white"
          >
            {isStreaming ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
