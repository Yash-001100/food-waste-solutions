import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Food Waste Solutions",
  description: "Surplus risk board and discount recommendations, per store.",
};

// Loaded via a plain <link> rather than next/font/google: next/font fetches
// the font at BUILD time from the machine running `next build`/`next dev`,
// which fails if that machine's network can't reach fonts.googleapis.com
// (as this sandbox's egress policy doesn't allow, discovered while building
// this). A <link> defers the fetch to the browser actually viewing the
// page, which has normal internet access - the same fallback the platform's
// own artifact-design guidance uses for this exact situation.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;600;700;800&family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface-page text-text-primary">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
