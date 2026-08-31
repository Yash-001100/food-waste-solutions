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
      <p className="text-3xl font-bold tracking-tight text-on-surface">{value}</p>
      {sub && <p className="mt-1 text-xs text-on-surface-variant">{sub}</p>}
    </div>
  );
}
