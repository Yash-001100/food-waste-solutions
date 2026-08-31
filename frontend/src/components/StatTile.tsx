"use client";

import { useEffect, useRef, useState } from "react";

const NUMBER_RE = /-?\d[\d,]*\.?\d*/;

function parseNumeric(raw: string): { value: number; decimals: number; hasCommas: boolean } | null {
  const match = raw.match(NUMBER_RE);
  if (!match) return null;
  const token = match[0];
  const value = Number(token.replace(/,/g, ""));
  if (Number.isNaN(value)) return null;
  return {
    value,
    decimals: token.includes(".") ? token.split(".")[1].length : 0,
    hasCommas: token.includes(","),
  };
}

function formatLike(n: number, decimals: number, hasCommas: boolean): string {
  const fixed = n.toFixed(decimals);
  if (!hasCommas) return fixed;
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart ? `${grouped}.${decPart}` : grouped;
}

/**
 * Renders an already-formatted stat string (e.g. "$154.3K", "1,481",
 * "62.5%") with its numeric portion counting up from 0 on mount/change -
 * an odometer-style reveal - while any currency symbol, suffix, or
 * non-numeric text (e.g. an action-type name, or the "—" empty state)
 * passes through untouched. No call site needs to change: the number is
 * parsed back out of the formatted string, animated, then re-formatted
 * with the same decimal places and comma grouping it already had.
 */
function AnimatedStatValue({ value }: { value: string }) {
  const parsed = parseNumeric(value);
  const [display, setDisplay] = useState(() =>
    parsed ? value.replace(NUMBER_RE, formatLike(0, parsed.decimals, parsed.hasCommas)) : value
  );
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!parsed) {
      setDisplay(value);
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setDisplay(value);
      return;
    }

    const target = parsed.value;
    const duration = 900;
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic - fast start, gentle settle
      setDisplay(value.replace(NUMBER_RE, formatLike(target * eased, parsed!.decimals, parsed!.hasCommas)));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
    // Re-run whenever the target value string changes (new data loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display}</>;
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="text-3xl font-bold tabular-nums tracking-tight text-on-surface">
        <AnimatedStatValue value={value} />
      </p>
      {sub && <p className="mt-1 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );
}
