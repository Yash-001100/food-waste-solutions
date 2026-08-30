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
    <div className="rounded-xl border border-border-strong bg-surface-card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">{label}</p>
      <p className="font-display text-3xl font-700 tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-text-secondary">{sub}</p>}
    </div>
  );
}
