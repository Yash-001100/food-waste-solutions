import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "material-symbols/outlined.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Food Waste Solutions",
  description: "Surplus risk board and discount recommendations, per store.",
};

// Inter and Material Symbols are self-hosted via @fontsource/inter and
// material-symbols (both npm packages that ship the actual woff2 files)
// rather than fetched from fonts.googleapis.com at request time. This
// started as a workaround for this sandbox's egress policy blocking that
// domain (confirmed: a CONNECT to fonts.googleapis.com gets a 403 from the
// proxy), but it's the better choice for the shipped app too - one fewer
// third-party origin, and the icon/font glyphs are always available even
// if the viewer's network or an ad/privacy blocker interferes with Google
// Fonts.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-on-surface">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
