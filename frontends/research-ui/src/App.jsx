import { useState, useCallback } from 'react'
import { useResearchAgent } from './hooks/useResearchAgent.js'
import { ChatThread } from './components/ChatThread.jsx'
import { ChatComposer } from './components/ChatComposer.jsx'
import { WelcomeScreen } from './components/WelcomeScreen.jsx'
import { Header } from './components/Header.jsx'

export default function App() {
  const agent = useResearchAgent()
  const hasMessages = agent.messages.length > 0

  const handleSend = useCallback((content) => {
    if (!content.trim() || agent.isRunning) return
    agent.sendMessage(content.trim())
  }, [agent])

  return (
    <div className="flex flex-col h-screen bg-white">
      <Header onNewChat={agent.clearChat} />

      <main className="flex-1 overflow-hidden flex flex-col">
        {hasMessages ? (
          <ChatThread messages={agent.messages} isRunning={agent.isRunning} />
        ) : (
          <WelcomeScreen onSuggestionClick={handleSend} />
        )}

        <ChatComposer
          onSend={handleSend}
          onStop={agent.abort}
          isRunning={agent.isRunning}
          placeholder={
            hasMessages
              ? 'Ask a follow-up question...'
              : 'What would you like to research?'
          }
        />
      </main>
    </div>
  )
}
