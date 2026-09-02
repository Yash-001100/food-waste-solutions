"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiskTier } from "@/lib/api";
import { formatUSD } from "@/lib/format";

export interface TreemapDatum {
  id: string;
  label: string;
  sub?: string | null;
  value: number;
  tier: RiskTier;
}

interface Rect<T> {
  x: number;
  y: number;
  w: number;
  h: number;
  item: T;
}

/**
 * Squarified treemap layout (Bruls/Huizing/van Wijk): greedily grows a row
 * along the container's current short side, closing the row once adding
 * the next item would make its rectangles less square, then recurses into
 * the remaining space. Works in area units directly (item.value already
 * scaled to the container's pixel area by the caller).
 */
function squarify<T extends { value: number }>(items: T[], x: number, y: number, w: number, h: number): Rect<T>[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  if (items.length === 1) return [{ x, y, w, h, item: items[0] }];

  const total = items.reduce((s, i) => s + i.value, 0);
  const areaTotal = w * h;
  const shortSide = Math.min(w, h);

  function worstRatio(row: T[], rowTotal: number): number {
    if (row.length === 0) return Infinity;
    const rowArea = (rowTotal / total) * areaTotal;
    const rowThickness = rowArea / shortSide;
    let worst = 0;
    for (const it of row) {
      const itemArea = (it.value / total) * areaTotal;
      const side = itemArea / rowThickness;
      const ratio = Math.max(rowThickness / side, side / rowThickness);
      if (ratio > worst) worst = ratio;
    }
    return worst;
  }

  let i = 1;
  let rowTotal = items[0].value;
  while (i < items.length) {
    const nextTotal = rowTotal + items[i].value;
    if (worstRatio(items.slice(0, i), rowTotal) <= worstRatio(items.slice(0, i + 1), nextTotal)) break;
    rowTotal = nextTotal;
    i++;
  }
  const row = items.slice(0, i);
  const rest = items.slice(i);
  const restTotal = total - rowTotal;
  const rowArea = (rowTotal / total) * areaTotal;

  const result: Rect<T>[] = [];
  if (w >= h) {
    const rowWidth = rowArea / h;
    let cy = y;
    for (const it of row) {
      const itemArea = (it.value / total) * areaTotal;
      const itemHeight = itemArea / rowWidth;
      result.push({ x, y: cy, w: rowWidth, h: itemHeight, item: it });
      cy += itemHeight;
    }
    // Derive the remaining width from restTotal/total (a ratio of item
    // values) rather than "w - rowWidth" (a subtraction of two pixel
    // dimensions computed independently): the two are mathematically
    // equal, but the subtraction form is prone to floating-point
    // cancellation after enough recursion levels, occasionally landing a
    // hair below 0 and tripping the w<=0 guard above - which used to
    // silently discard every remaining item, leaving blank gaps in the
    // rendered map. Deriving it from the value ratio is always >= 0.
    const remainingWidth = restTotal > 0 ? w * (restTotal / total) : 0;
    return result.concat(squarify(rest, x + rowWidth, y, remainingWidth, h));
  } else {
    const rowHeight = rowArea / w;
    let cx = x;
    for (const it of row) {
      const itemArea = (it.value / total) * areaTotal;
      const itemWidth = itemArea / rowHeight;
      result.push({ x: cx, y, w: itemWidth, h: rowHeight, item: it });
      cx += itemWidth;
    }
    const remainingHeight = restTotal > 0 ? h * (restTotal / total) : 0;
    return result.concat(squarify(rest, x, y + rowHeight, w, remainingHeight));
  }
}

const TIER_STYLE: Record<RiskTier, { bg: string; text: string; chipBg: string; chipText: string }> = {
  Critical: { bg: "bg-error-container", text: "text-on-error-container", chipBg: "bg-error", chipText: "text-on-error" },
  High: { bg: "bg-tertiary-fixed", text: "text-on-tertiary-fixed", chipBg: "bg-tertiary-fixed-dim", chipText: "text-on-tertiary-fixed" },
  Medium: { bg: "bg-tertiary-fixed/60", text: "text-on-tertiary-fixed", chipBg: "bg-tertiary-fixed", chipText: "text-on-tertiary-fixed" },
  Low: { bg: "bg-secondary-container/60", text: "text-on-secondary-container", chipBg: "bg-secondary-container", chipText: "text-on-secondary-container" },
};

export function Treemap({ data, onSelect }: { data: TreemapDatum[]; onSelect: (id: string) => void }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Measured in real pixels (via ResizeObserver below) rather than laid out
  // against a fixed logical size, so the map stays properly proportioned -
  // not stretched - when the user drags the resizable box below to a
  // different aspect ratio.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rects = useMemo(() => {
    if (!size || size.w <= 0 || size.h <= 0) return [];
    const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    return squarify(sorted, 0, 0, size.w, size.h);
  }, [data, size]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {size && rects.length === 0 && (
        <p className="p-6 text-center text-sm text-on-surface-variant">Nothing to show for this filter.</p>
      )}
      {rects.map(({ x, y, w, h, item }) => {
        const style = TIER_STYLE[item.tier];
        const showLabel = w > 64 && h > 34;
        const showSub = w > 90 && h > 66;
        const hovered = hoverId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            onMouseEnter={() => setHoverId(item.id)}
            onMouseLeave={() => setHoverId((cur) => (cur === item.id ? null : cur))}
            title={`${item.label} — ${formatUSD(item.value)}`}
            className={`absolute overflow-hidden border-2 border-surface text-left transition-[filter] ${style.bg} ${style.text} ${
              hovered ? "z-10 brightness-95" : ""
            }`}
            style={{ left: x, top: y, width: w, height: h }}
          >
            {showLabel && (
              <div className="flex h-full flex-col justify-between p-2">
                <div>
                  {h > 50 && (
                    <span className={`mb-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chipBg} ${style.chipText}`}>
                      {item.tier}
                    </span>
                  )}
                  <p className="line-clamp-2 text-xs font-semibold leading-snug">{item.label}</p>
                  {showSub && item.sub && <p className="mt-0.5 text-[11px] opacity-80">{item.sub}</p>}
                </div>
                <p className="text-sm font-bold tabular-nums">{formatUSD(item.value)}</p>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
