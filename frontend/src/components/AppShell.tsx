"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname !== "/login") {
      router.replace("/login");
    }
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted font-mono text-sm">
        Loading...
      </div>
    );
  }

  if (!user) {
    // Redirect is in flight (or this is /login, which renders its own shell).
    return <>{children}</>;
  }

  const nav = [
    { href: `/stores/${user.store}`, label: "Risk board" },
    { href: `/stores/${user.store}/transfers`, label: "Transfers" },
    { href: "/actions", label: "Action history" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border-strong bg-surface-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-xl font-700 tracking-tight">
            Food Waste Solutions
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-text-secondary">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-text-primary transition-colors">
                {item.label}
              </Link>
            ))}
            <span className="h-4 w-px bg-border-strong" />
            <span className="font-mono text-xs text-text-muted">{user.display_name}</span>
            <button
              onClick={logout}
              className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:border-accent hover:text-accent transition-colors"
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
