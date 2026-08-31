"use client";

import { useMemo, useState } from "react";

interface Point {
  x: number; // days_remaining, descending
  y: number;
}

/**
 * A single-series line+area chart with a hover crosshair/tooltip, following
 * the dataviz mark spec: 2px line, 10%-opacity area wash, hairline
 * gridlines, an end-marker with a value label, one axis only. Two of these
 * (stock remaining, discount applied) are used side by side rather than one
 * dual-axis chart, since the two measures are on incomparable scales.
 */
export function ScheduleChart({
  points,
  color,
  valueFormat,
  height = 160,
}: {
  points: Point[];
  color: string;
  valueFormat: (v: number) => string;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 560;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const { path, areaPath, coords, yMax } = useMemo(() => {
    const yMax = Math.max(...points.map((p) => p.y), 1) * 1.1;
    const n = points.length;
    const coords = points.map((p, i) => ({
      x: padding.left + (n === 1 ? 0 : (i / (n - 1)) * innerW),
      y: padding.top + innerH - (p.y / yMax) * innerH,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
    const areaPath = `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${padding.top + innerH} L ${coords[0].x.toFixed(1)} ${padding.top + innerH} Z`;
    return { path, areaPath, coords, yMax };
  }, [points, innerW, innerH]);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const n = points.length;
    const idx = Math.round(((px - padding.left) / innerW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  }

  const gridLines = [0, 0.5, 1];
  const last = coords[coords.length - 1];
  const hovered = hoverIdx !== null ? { point: points[hoverIdx], coord: coords[hoverIdx] } : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {gridLines.map((g) => (
        <line
          key={g}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH * (1 - g)}
          y2={padding.top + innerH * (1 - g)}
          stroke="var(--color-outline-variant)"
          strokeWidth={1}
        />
      ))}

      <path d={areaPath} fill={color} opacity={0.1} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* end marker + direct label */}
      <circle cx={last.x} cy={last.y} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
      <text x={last.x - 6} y={last.y - 10} textAnchor="end" fontSize={11} fill="var(--color-on-surface)">
        {valueFormat(points[points.length - 1].y)}
      </text>

      {/* first point label */}
      <circle cx={coords[0].x} cy={coords[0].y} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />

      {hovered && (
        <g>
          <line
            x1={hovered.coord.x}
            x2={hovered.coord.x}
            y1={padding.top}
            y2={padding.top + innerH}
            stroke="var(--color-on-surface-variant)"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
          <circle cx={hovered.coord.x} cy={hovered.coord.y} r={5} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
        </g>
      )}

      {/* x-axis endpoints */}
      <text x={padding.left} y={height - 6} fontSize={10} fill="var(--color-on-surface-variant)">
        {points[0].x}d left
      </text>
      <text x={width - padding.right} y={height - 6} textAnchor="end" fontSize={10} fill="var(--color-on-surface-variant)">
        {points[points.length - 1].x}d left
      </text>

      {hovered && (
        <g transform={`translate(${Math.min(Math.max(hovered.coord.x - 45, 0), width - 90)}, 4)`}>
          <rect width={90} height={20} rx={4} fill="var(--color-surface-container-low)" stroke="var(--color-outline-variant)" />
          <text x={45} y={14} textAnchor="middle" fontSize={11} fill="var(--color-on-surface)">
            {hovered.point.x}d: {valueFormat(hovered.point.y)}
          </text>
        </g>
      )}
    </svg>
  );
}
