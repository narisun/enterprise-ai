import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { TelemetryProvider } from "@/components/telemetry/TelemetryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enterprise AI",
  description: "Enterprise Agentic Analytics Platform",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <TelemetryProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </TelemetryProvider>
      </body>
    </html>
  );
}
