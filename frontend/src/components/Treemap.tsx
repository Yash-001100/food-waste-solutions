"use client";

import { useMemo, useState } from "react";
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
    return result.concat(squarify(rest, x + rowWidth, y, w - rowWidth, h));
  } else {
    const rowHeight = rowArea / w;
    let cx = x;
    for (const it of row) {
      const itemArea = (it.value / total) * areaTotal;
      const itemWidth = itemArea / rowHeight;
      result.push({ x: cx, y, w: itemWidth, h: rowHeight, item: it });
      cx += itemWidth;
    }
    return result.concat(squarify(rest, x, y + rowHeight, w, h - rowHeight));
  }
}

const TIER_STYLE: Record<RiskTier, { bg: string; text: string; chipBg: string; chipText: string }> = {
  Critical: { bg: "bg-error-container", text: "text-on-error-container", chipBg: "bg-error", chipText: "text-on-error" },
  High: { bg: "bg-tertiary-fixed", text: "text-on-tertiary-fixed", chipBg: "bg-tertiary-fixed-dim", chipText: "text-on-tertiary-fixed" },
  Medium: { bg: "bg-tertiary-fixed/60", text: "text-on-tertiary-fixed", chipBg: "bg-tertiary-fixed", chipText: "text-on-tertiary-fixed" },
  Low: { bg: "bg-secondary-container/60", text: "text-on-secondary-container", chipBg: "bg-secondary-container", chipText: "text-on-secondary-container" },
};

const WIDTH = 1000;
const HEIGHT = 420;

export function Treemap({ data, onSelect }: { data: TreemapDatum[]; onSelect: (id: string) => void }) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const rects = useMemo(() => {
    const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    return squarify(sorted, 0, 0, WIDTH, HEIGHT);
  }, [data]);

  if (rects.length === 0) {
    return <p className="p-6 text-center text-sm text-on-surface-variant">Nothing to show for this filter.</p>;
  }

  return (
    <div className="relative w-full" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
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
            style={{ left: `${(x / WIDTH) * 100}%`, top: `${(y / HEIGHT) * 100}%`, width: `${(w / WIDTH) * 100}%`, height: `${(h / HEIGHT) * 100}%` }}
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
