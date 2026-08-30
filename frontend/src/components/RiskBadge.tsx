import { RiskTier } from "@/lib/api";

const RISK_STYLES: Record<RiskTier, { bg: string; label: string }> = {
  Low: { bg: "var(--risk-low)", label: "Low" },
  Medium: { bg: "var(--risk-medium)", label: "Medium" },
  High: { bg: "var(--risk-high)", label: "High" },
  Critical: { bg: "var(--risk-critical)", label: "Critical" },
};

// Warning/serious sit below 3:1 contrast on the light surface by design (see
// dataviz palette.md) - text on those two backgrounds uses dark ink instead
// of white so the label stays legible; low/critical get white text.
const DARK_TEXT_TIERS = new Set<RiskTier>(["Medium", "High"]);

export function RiskBadge({ tier }: { tier: RiskTier }) {
  const style = RISK_STYLES[tier];
  const dark = DARK_TEXT_TIERS.has(tier);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase"
      style={{ backgroundColor: style.bg, color: dark ? "#0b0b0b" : "#ffffff" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dark ? "#0b0b0b" : "#ffffff" }} />
      {style.label}
    </span>
  );
}
