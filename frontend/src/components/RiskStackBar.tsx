import { StoreSummary } from "@/lib/api";

/**
 * A single stacked horizontal bar: Low/Medium/High/Critical share of a
 * store's items, using the fixed status palette (never the categorical
 * series colors) so it reads consistently with RiskBadge everywhere else.
 * A 2px surface gap separates each segment, per the dataviz mark spec.
 */
export function RiskStackBar({ summary }: { summary: StoreSummary }) {
  const segments = [
    { count: summary.critical, color: "var(--risk-critical)", label: "Critical" },
    { count: summary.high, color: "var(--risk-high)", label: "High" },
    { count: summary.medium, color: "var(--risk-medium)", label: "Medium" },
    { count: summary.low, color: "var(--risk-low)", label: "Low" },
  ];
  const total = summary.total_items || 1;

  return (
    <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img"
      aria-label={segments.map((s) => `${s.label} ${s.count}`).join(", ")}>
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
