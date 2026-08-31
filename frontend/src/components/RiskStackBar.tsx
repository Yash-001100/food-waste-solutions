import { StoreSummary } from "@/lib/api";

/**
 * A single stacked horizontal bar: Low/Medium/High/Critical share of a
 * store's items, using the same fixed risk-tier colors as RiskBadge (never
 * the categorical series palette) so it reads consistently everywhere else.
 * A hairline surface gap separates each segment, per the dataviz mark spec.
 */
export function RiskStackBar({ summary }: { summary: StoreSummary }) {
  const segments = [
    { count: summary.critical, color: "var(--color-error)", label: "Critical" },
    { count: summary.high, color: "var(--color-tertiary-fixed-dim)", label: "High" },
    { count: summary.medium, color: "var(--color-tertiary-fixed)", label: "Medium" },
    { count: summary.low, color: "var(--color-secondary-container)", label: "Low" },
  ];
  const total = summary.total_items || 1;

  return (
    <div
      className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
      role="img"
      aria-label={segments.map((s) => `${s.label} ${s.count}`).join(", ")}
    >
      {segments.map((s) =>
        s.count > 0 ? (
          <div
            key={s.label}
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.count}`}
          />
        ) : null
      )}
    </div>
  );
}
