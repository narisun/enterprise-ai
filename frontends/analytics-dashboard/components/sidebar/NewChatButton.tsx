"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NewChatButtonProps {
  onClick: () => void;
}

export function NewChatButton({ onClick }: NewChatButtonProps) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      className="w-full justify-start gap-2 text-xs"
    >
      <Plus size={14} />
      New Chat
    </Button>
  );
}
