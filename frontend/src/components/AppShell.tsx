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
      <div className="flex flex-1 items-center justify-center text-sm text-on-surface-variant">Loading...</div>
    );
  }

  if (!user) {
    // Redirect is in flight (or this is /login, which renders its own shell).
    return <>{children}</>;
  }

  const nav = [
    { href: `/`, label: "Store overview", icon: "storefront" },
    { href: `/stores/${user.store}`, label: "Risk board", icon: "warning" },
    { href: "/analytics", label: "Analytics", icon: "monitoring" },
    { href: `/stores/${user.store}/transfers`, label: "Transfers", icon: "swap_horiz" },
    { href: "/store-map", label: "Store Map", icon: "map" },
    { href: "/receive-stock", label: "Receive stock", icon: "local_shipping" },
    { href: "/actions", label: "Action history", icon: "history" },
  ];

  // Pick the single longest matching href so a parent route (the risk
  // board) never stays lit up alongside a more specific child route
  // (transfers) that happens to share its path prefix.
  const matches = nav.filter(
    (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"))
  );
  const activeHref = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="flex min-h-screen w-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low print:hidden">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 26 }}>
            eco
          </span>
          <span className="text-base font-bold leading-tight tracking-tight text-on-surface">
            Food Waste
            <br />
            Solutions
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-outline-variant px-3 py-4">
          <div className="flex items-center justify-between rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-on-surface">{user.display_name}</p>
              <p className="text-xs text-on-surface-variant">{user.store}</p>
            </div>
            <button
              onClick={logout}
              title="Log out"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                logout
              </span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
