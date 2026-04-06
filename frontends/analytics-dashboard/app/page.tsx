"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { TopBar } from "@/components/layout/TopBar";
import { useConversations, loadMessages } from "@/hooks/useConversations";
import { generateId } from "@/lib/utils";

export default function HomePage() {
  const [activeChatId, setActiveChatId] = useState(() => generateId());
  const { conversations, save, remove, rename } = useConversations();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hasMessages, setHasMessages] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeChatId);
  const conversationTitle = activeConversation?.title || "";

  const handleNewChat = useCallback(() => {
    setActiveChatId(generateId());
    setHasMessages(false);
  }, []);

  const handleSelectChat = useCallback((id: string) => {
    setActiveChatId(id);
    // Check if this conversation has persisted messages
    const saved = loadMessages(id);
    setHasMessages(saved.length > 0);
  }, []);

  const handleDeleteChat = useCallback(
    (id: string) => {
      remove(id);
      if (id === activeChatId) {
        setActiveChatId(generateId());
        setHasMessages(false);
      }
    },
    [activeChatId, remove]
  );

  const handleNewMessage = useCallback(
    (chatId: string, firstMessage: string) => {
      save(chatId, firstMessage, 1);
      setHasMessages(true);
    },
    [save]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div
        className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
          sidebarOpen ? "w-64" : "w-0"
        }`}
      >
        <div className="w-64 h-full">
          <Sidebar
            conversations={conversations}
            activeChatId={activeChatId}
            onNewChat={handleNewChat}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
            onRenameChat={rename}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar
          title={hasMessages ? conversationTitle : ""}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onNewChat={handleNewChat}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          <ChatContainer
            key={activeChatId}
            chatId={activeChatId}
            onNewMessage={handleNewMessage}
          />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
