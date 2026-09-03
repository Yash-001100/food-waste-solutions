"use client";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  // Optional small annotation shown next to the count in the legend (e.g. a
  // real dollar figure for that slice) - the arc itself still sizes by
  // `value` (count), this is just extra context alongside it.
  sub?: string;
}

/**
 * A hand-rolled SVG donut with a center total and a legend, following the
 * same no-library approach as the rest of this dashboard's charts. Colors
 * are passed in by the caller rather than generated here, so the outcome
 * quality gradient (Donated=good, Deep markdown=middling, Disposed=worst)
 * can reuse the app's existing status tokens instead of an arbitrary
 * categorical palette.
 */
export function DonutChart({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const size = 160;
  const r = 62;
  const stroke = 22;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = slices.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const dash = frac * circumference;
    const arc = { ...s, dash, gap: circumference - dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-surface-container)" strokeWidth={stroke} />
        {total > 0 &&
          arcs.map((a, i) => (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeDasharray={`${a.dash} ${a.gap}`}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${c} ${c})`}
            />
          ))}
        <text x={c} y={c - 4} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--color-on-surface)">
          {total.toLocaleString()}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize={10} fill="var(--color-on-surface-variant)">
          {centerLabel}
        </text>
      </svg>

      <div className="flex-1 space-y-1.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-on-surface">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="text-right">
              <span className="tabular-nums text-on-surface-variant">
                {s.value.toLocaleString()} ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)
              </span>
              {s.sub && <span className="ml-1.5 tabular-nums text-xs text-on-surface-variant">· {s.sub}</span>}
            </span>
          </div>
        ))}
        {slices.length === 0 && <p className="text-sm text-on-surface-variant">No actions logged yet.</p>}
      </div>
    </div>
  );
}
