"use client";

import { Settings, Monitor, Sun, Moon, X } from "lucide-react";
import { useState } from "react";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-muted hover:text-text hover:bg-surface-2 rounded-lg transition-colors"
      >
        <Settings size={14} />
        <span>Settings</span>
      </button>

      {/* Settings overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold text-text">Settings</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Theme selector */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Appearance
              </label>
              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border p-3 text-xs transition-colors",
                        isActive
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface-2 text-text-muted hover:border-text-muted/40 hover:text-text"
                      )}
                    >
                      <Icon size={18} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
