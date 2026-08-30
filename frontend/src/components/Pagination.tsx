export function Pagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  if (totalCount === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between text-sm text-text-secondary">
      <p>
        Showing {start}&ndash;{end} of {totalCount.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-accent disabled:opacity-40 disabled:hover:border-border-strong"
        >
          Previous
        </button>
        <span className="font-mono text-xs text-text-muted">
          Page {page} / {totalPages}
        </span>
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-accent disabled:opacity-40 disabled:hover:border-border-strong"
        >
          Next
        </button>
      </div>
    </div>
  );
}
