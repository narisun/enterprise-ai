"use client";

import { useEffect } from "react";
import { initTelemetry } from "@/lib/telemetry";

/**
 * Client component that initializes OpenTelemetry on mount.
 * Wraps the app to ensure tracing is set up before any user interaction.
 */
export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTelemetry();
  }, []);

  return <>{children}</>;
}
