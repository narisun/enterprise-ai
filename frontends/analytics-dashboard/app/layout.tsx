import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { TelemetryProvider } from "@/components/telemetry/TelemetryProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

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
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className={`min-h-screen bg-background antialiased ${inter.className}`}>
        <Auth0Provider>
          <TelemetryProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </TelemetryProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
