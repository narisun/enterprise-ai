/**
 * App — Root component assembling the three-panel analytics layout.
 *
 * ┌────────────┬──────────────────────┬────────────┐
 * │  ChatPanel  │     CanvasArea       │ TracePanel │
 * │  (320px)    │     (flex-1)         │  (280px)   │
 * └────────────┴──────────────────────┴────────────┘
 */
import { useChat } from "./hooks/useChat";
import { ChatPanel } from "./components/ChatPanel";
import { CanvasArea } from "./components/CanvasArea";
import { TracePanel } from "./components/TracePanel";

export default function App() {
  const {
    messages,
    sendMessage,
    streamStatus,
    streamNarrative,
    streamComponents,
    streamTraceEvents,
    streamError,
  } = useChat();

  // Merge completed message components with live stream components
  const allComponents = [
    ...messages.flatMap((m) => m.components ?? []),
    ...streamComponents,
  ];

  // Merge completed trace events with live stream trace events
  const allTraceEvents = [
    ...messages.flatMap((m) => m.traceEvents ?? []),
    ...streamTraceEvents,
  ];

  return (
    <div className="flex h-screen w-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Left — Chat */}
      <div className="w-80 flex-shrink-0">
        <ChatPanel
          messages={messages}
          streamStatus={streamStatus}
          streamNarrative={streamNarrative}
          onSend={sendMessage}
        />
      </div>

      {/* Center — Canvas */}
      <CanvasArea
        components={allComponents}
        streamStatus={streamStatus}
      />

      {/* Right — Trace */}
      <div className="w-72 flex-shrink-0">
        <TracePanel
          traceEvents={allTraceEvents}
          streamStatus={streamStatus}
        />
      </div>

      {/* Error toast */}
      {streamError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50
          bg-red-900/90 text-red-200 text-sm px-4 py-2.5 rounded-xl
          border border-red-800 shadow-lg animate-fade-in max-w-md">
          {streamError}
        </div>
      )}
    </div>
  );
}
