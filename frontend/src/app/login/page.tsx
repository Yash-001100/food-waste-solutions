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
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-3xl font-800 tracking-tight text-center mb-1">
          Food Waste Solutions
        </h1>
        <p className="text-center text-sm text-text-secondary mb-8">
          Store associate sign-in
        </p>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border-strong bg-surface-card p-6 shadow-sm space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
              Username (store code)
            </label>
            <select
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface-page px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            >
              {DEMO_STORES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface-page px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
          </div>

          {error && (
            <p className="text-sm font-medium" style={{ color: "var(--risk-critical)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-xs text-text-muted text-center pt-1">
            Demo accounts: any store code, password{" "}
            <code className="font-mono">foodwaste2026</code>
          </p>
        </form>
      </div>
    </div>
  );
}
