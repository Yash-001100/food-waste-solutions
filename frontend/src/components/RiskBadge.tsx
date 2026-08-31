import { RiskTier } from "@/lib/api";

/*
 * Four visually distinct tiers, all drawn from the mockup's own Material-3
 * palette. The mockup's exported code actually reused one amber tone for
 * both High and Medium (fine for a static screenshot, not for a real badge
 * set), so High is stepped one tone darker (tertiary-fixed-dim) and Medium
 * keeps the mockup's lighter tertiary-fixed - same family, distinguishable.
 */
const RISK_STYLES: Record<RiskTier, { bg: string; text: string; label: string }> = {
  Low: { bg: "bg-secondary-container", text: "text-on-secondary-container", label: "Low" },
  Medium: { bg: "bg-tertiary-fixed", text: "text-on-tertiary-fixed", label: "Medium" },
  High: { bg: "bg-tertiary-fixed-dim", text: "text-on-tertiary-fixed", label: "High" },
  Critical: { bg: "bg-error", text: "text-on-error", label: "Critical" },
};

export function RiskBadge({ tier }: { tier: RiskTier }) {
  const style = RISK_STYLES[tier];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase ${style.bg} ${style.text}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {style.label}
    </span>
  );
}
