"use client";

import { useMemo, useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
  tooltip?: string;
}

/**
 * A single-series bar chart following the same hand-rolled SVG approach and
 * dataviz mark spec as ScheduleChart: thin bars with 4px rounded data-ends,
 * a hairline baseline, one axis, and a hover tooltip - rather than a
 * generic charting library, to match the rest of this dashboard. Used for
 * both a real daily-sales time series (many thin bars, only endpoint x
 * labels) and a small categorical bucket comparison (few wider bars, every
 * label shown).
 */
export function BarChart({
  data,
  color,
  valueFormat,
  height = 200,
  showAllLabels = false,
}: {
  data: BarDatum[];
  color: string;
  valueFormat: (v: number) => string;
  height?: number;
  showAllLabels?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 640;
  const padding = { top: 12, right: 12, bottom: 28, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const { bars, yMax } = useMemo(() => {
    const yMax = Math.max(...data.map((d) => d.value), 1) * 1.15;
    const n = data.length;
    const gap = n > 40 ? 1 : 4;
    const barW = Math.max(1, innerW / n - gap);
    const bars = data.map((d, i) => {
      const x = padding.left + (i / n) * innerW + gap / 2;
      const h = (d.value / yMax) * innerH;
      const y = padding.top + innerH - h;
      return { x, y, w: barW, h: Math.max(h, d.value > 0 ? 1.5 : 0) };
    });
    return { bars, yMax };
  }, [data, innerW, innerH]);

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const hoveredBar = hoverIdx !== null ? bars[hoverIdx] : null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.floor(((px - padding.left) / innerW) * data.length);
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  if (data.length === 0) {
    return <p className="text-sm text-on-surface-variant">No data.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + innerH}
        y2={padding.top + innerH}
        stroke="var(--color-outline-variant)"
        strokeWidth={1}
      />

      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={Math.min(2, b.w / 2)}
          fill={color}
          opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
        />
      ))}

      {showAllLabels
        ? data.map((d, i) => (
            <text
              key={i}
              x={bars[i].x + bars[i].w / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-on-surface-variant)"
            >
              {d.label}
            </text>
          ))
        : (
          <>
            <text x={padding.left} y={height - 8} fontSize={10} fill="var(--color-on-surface-variant)">
              {data[0].label}
            </text>
            <text x={width - padding.right} y={height - 8} textAnchor="end" fontSize={10} fill="var(--color-on-surface-variant)">
              {data[data.length - 1].label}
            </text>
          </>
        )}

      {hovered && hoveredBar && (
        <g transform={`translate(${Math.min(Math.max(hoveredBar.x - 55, 0), width - 130)}, 4)`}>
          <rect width={140} height={34} rx={4} fill="var(--color-surface-container-low)" stroke="var(--color-outline-variant)" />
          <text x={8} y={14} fontSize={11} fill="var(--color-on-surface)">
            {hovered.label}
          </text>
          <text x={8} y={27} fontSize={11} fontWeight={600} fill="var(--color-on-surface)">
            {hovered.tooltip ?? valueFormat(hovered.value)}
          </text>
        </g>
      )}
    </svg>
  );
}
