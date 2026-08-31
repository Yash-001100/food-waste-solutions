"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth, ApiError } from "@/lib/auth-context";

const DEMO_STORES = ["ca_1", "ca_2", "ca_3", "ca_4", "tx_1", "tx_2", "tx_3", "wi_1", "wi_2", "wi_3"];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("ca_2");
  const [password, setPassword] = useState("foodwaste2026");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      router.push(`/stores/${username.toUpperCase()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the API.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="material-symbols-outlined mb-3 text-primary" style={{ fontSize: 40 }}>
            eco
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface">Food Waste Solutions</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Store associate sign-in</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-outline-variant bg-surface p-6 shadow-sm"
        >
          <div className="flex items-start gap-2.5 rounded-lg bg-secondary-container px-3.5 py-3 text-on-secondary-container">
            <span className="material-symbols-outlined mt-0.5" style={{ fontSize: 18 }}>
              info
            </span>
            <p className="text-xs leading-snug">
              Demo access: pick any store code, password <code className="font-semibold">foodwaste2026</code>
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Store code
            </label>
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>
                storefront
              </span>
              <select
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full appearance-none rounded-md border border-outline-variant bg-surface-container-low py-2 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
              >
                {DEMO_STORES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Password
            </label>
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>
                lock
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-low py-2 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
              />
            </div>
          </div>

          {error && <p className="text-sm font-medium text-error">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
            {!submitting && (
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                arrow_forward
              </span>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-on-surface-variant">Food Waste Solutions · demo build</p>
      </div>
    </div>
  );
}
