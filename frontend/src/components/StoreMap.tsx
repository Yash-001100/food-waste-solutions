"use client";

import { useMemo, useState } from "react";
import { StoreMapLane, StoreMapPoint } from "@/lib/api";

/**
 * A hand-rolled map of all 10 stores, following the same SVG approach as
 * the rest of the dashboard's charts (ScheduleChart/BarChart/DonutChart)
 * rather than pulling in a mapping library. Store positions are a real
 * equirectangular projection (simple lat/lon -> x/y, standard for a
 * regional extent like the continental US) of REAL coordinates for each
 * store's disclosed stand-in city - not a literal coastline map, since
 * drawing an accurate US border from memory risks being wrong in a way
 * that looks more authoritative than it is. The straight lines between
 * stores are real transfer lanes (scripts/07 + 08), not decoration - a
 * line only exists here if that route is currently real and cost-effective.
 *
 * Deliberately NOT included, because none of it is real data this project
 * has: live GPS, "couriers en route," live traffic, dock/receiving windows,
 * store contacts. See store-map/page.tsx for what replaces each of those.
 */

const LON_MIN = -125;
const LON_MAX = -66;
const LAT_MIN = 24;
const LAT_MAX = 50;

const STATE_COLOR: Record<string, string> = {
  CA: "var(--color-primary)",
  TX: "var(--color-secondary)",
  WI: "var(--color-tertiary-fixed-dim)",
};

// Sequential single-hue ramp (light -> dark, dataviz convention for
// magnitude) from a pale error tint up to the full error red, keyed to how
// many Critical items sit at that store right now - a real count, not a
// fabricated "demand" score.
const RISK_LOW = { r: 0xff, g: 0xda, b: 0xd6 }; // --color-error-container
const RISK_HIGH = { r: 0xba, g: 0x1a, b: 0x1a }; // --color-error
function riskColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(RISK_LOW.r + (RISK_HIGH.r - RISK_LOW.r) * c);
  const g = Math.round(RISK_LOW.g + (RISK_HIGH.g - RISK_LOW.g) * c);
  const b = Math.round(RISK_LOW.b + (RISK_HIGH.b - RISK_LOW.b) * c);
  return `rgb(${r}, ${g}, ${b})`;
}

// Same-state sister stores sit as little as ~75 real miles apart, which is
// only a few pixels at this national scale, and every currently-active lane
// in this dataset happens to be within one of those tight clusters. A
// simple "is another MARKER nearby" check isn't enough - a label can land
// on a marker or another label that's far enough away not to trip a raw
// point-to-point distance check. So everything text-shaped (store code
// labels AND, when the distances toggle is on, lane distance labels)
// shares one box-collision pass: real bounding boxes, checked against every
// marker and every label already placed, in priority order.
type Box = { left: number; right: number; top: number; bottom: number };
const boxesOverlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function StoreMap({
  stores,
  lanes,
  highlightStore,
  colorMode,
  showDistances,
  searchQuery,
}: {
  stores: StoreMapPoint[];
  lanes: StoreMapLane[];
  highlightStore?: string | null;
  colorMode: "state" | "risk";
  showDistances: boolean;
  searchQuery: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const width = 760;
  const height = 440;
  const padding = { top: 24, right: 24, bottom: 24, left: 24 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const query = searchQuery.trim().toLowerCase();
  const matches = (s: StoreMapPoint) =>
    query.length === 0 || s.store.toLowerCase().includes(query) || s.city.toLowerCase().includes(query);

  const points = useMemo(() => {
    const maxCritical = Math.max(...stores.map((s) => s.critical_items), 1);
    return stores.map((s) => {
      const x = padding.left + ((s.lon - LON_MIN) / (LON_MAX - LON_MIN)) * innerW;
      const y = padding.top + ((LAT_MAX - s.lat) / (LAT_MAX - LAT_MIN)) * innerH;
      const r = 7 + Math.sqrt(s.critical_items / maxCritical) * 12;
      const fill =
        colorMode === "risk" ? riskColor(s.critical_items / maxCritical) : STATE_COLOR[s.state] ?? "var(--color-outline)";
      return { ...s, x, y, r, fill };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, innerW, innerH, colorMode]);

  const byStore = useMemo(() => Object.fromEntries(points.map((p) => [p.store, p])), [points]);

  const laneSegments = useMemo(() => {
    const maxCount = Math.max(...lanes.map((l) => l.item_count), 1);
    return lanes
      .map((l) => {
        const a = byStore[l.origin_store];
        const b = byStore[l.destination_store];
        if (!a || !b) return null;
        return {
          ...l,
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
          width: 1.5 + (l.item_count / maxCount) * 3,
          color: colorMode === "risk" ? "var(--color-outline)" : STATE_COLOR[a.state] ?? "var(--color-outline)",
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [lanes, byStore, colorMode]);

  // Single collision-aware placement pass for every label on the map -
  // store codes always win the best spot (they're never optional); lane
  // distance labels, when the toggle is on, take the next-best spot behind
  // the biggest-value lanes first, or are skipped outright rather than
  // forced onto an overlapping position.
  const { storeLabels, laneLabels } = useMemo(() => {
    const markerBoxes: Box[] = points.map((p) => ({ left: p.x - p.r, right: p.x + p.r, top: p.y - p.r, bottom: p.y + p.r }));
    const placedBoxes: Box[] = [];
    const clear = (box: Box, skipMarker?: number) =>
      markerBoxes.every((m, j) => j === skipMarker || !boxesOverlap(box, m)) && placedBoxes.every((l) => !boxesOverlap(box, l));

    const storeLabels = points.map((p, i) => {
      const labelWidth = p.store.length * 6.8 + 6;
      const half = labelWidth / 2;
      // Real gaps between bands (not touching edges) so a hairline rounding
      // difference can't reintroduce the exact overlap this is fixing.
      const candidates: { box: Box; dy: "above" | "below" | "farBelow" }[] = [
        { box: { left: p.x - half, right: p.x + half, top: p.y - p.r - 16, bottom: p.y - p.r - 2 }, dy: "above" },
        { box: { left: p.x - half, right: p.x + half, top: p.y + p.r + 2, bottom: p.y + p.r + 16 }, dy: "below" },
        { box: { left: p.x - half, right: p.x + half, top: p.y + p.r + 20, bottom: p.y + p.r + 34 }, dy: "farBelow" },
      ];
      // If every band still collides (a tight 3-way cluster), the last
      // (farthest) band is the least-bad choice - never silently fall back
      // to "below", which is exactly the band most likely to still overlap.
      const chosen = candidates.find((c) => clear(c.box, i)) ?? candidates[candidates.length - 1];
      placedBoxes.push(chosen.box);
      return { store: p.store, x: p.x, y: p.y, r: p.r, dy: chosen.dy };
    });

    const laneLabels = showDistances
      ? [...laneSegments]
          .sort((a, b) => b.batch_value - a.batch_value)
          .map((l) => {
            const dx = l.x2 - l.x1;
            const dy = l.y2 - l.y1;
            const len = Math.hypot(dx, dy);
            if (len < 26) return { key: `${l.origin_store}-${l.destination_store}`, hidden: true as const };
            const nx = -dy / len;
            const ny = dx / len;
            const text = `${l.distance_miles.toLocaleString()} mi`;
            const labelWidth = text.length * 5.6 + 6;
            const half = labelWidth / 2;
            const boxAt = (cx: number, cy: number): Box => ({ left: cx - half, right: cx + half, top: cy - 8, bottom: cy + 4 });
            const candidates = [
              { x: l.mx, y: l.my - 4, box: boxAt(l.mx, l.my - 4) },
              { x: l.mx + nx * 13, y: l.my + ny * 13, box: boxAt(l.mx + nx * 13, l.my + ny * 13) },
              { x: l.mx - nx * 13, y: l.my - ny * 13, box: boxAt(l.mx - nx * 13, l.my - ny * 13) },
            ];
            const chosen = candidates.find((c) => clear(c.box));
            if (!chosen) return { key: `${l.origin_store}-${l.destination_store}`, hidden: true as const };
            placedBoxes.push(chosen.box);
            return { key: `${l.origin_store}-${l.destination_store}`, hidden: false as const, x: chosen.x, y: chosen.y, text };
          })
      : [];

    return { storeLabels, laneLabels };
  }, [points, laneSegments, showDistances]);

  const laneLabelByKey = useMemo(() => Object.fromEntries(laneLabels.map((l) => [l.key, l])), [laneLabels]);
  const storeLabelByStore = useMemo(() => Object.fromEntries(storeLabels.map((l) => [l.store, l])), [storeLabels]);

  const hovered = hover ? byStore[hover] : null;
  const hoveredLanes = hover
    ? laneSegments.filter((l) => l.origin_store === hover || l.destination_store === hover)
    : [];
  const searchActive = query.length > 0;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <rect
          x={padding.left} y={padding.top} width={innerW} height={innerH}
          rx={8} fill="var(--color-surface-container-low)" stroke="var(--color-outline-variant)"
        />

        {laneSegments.map((l, i) => {
          const key = `${l.origin_store}-${l.destination_store}`;
          const label = laneLabelByKey[key];
          return (
            <g key={i} opacity={!hover || hoveredLanes.includes(l) ? 1 : 0.15}>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={l.width} strokeLinecap="round" />
              {label && !label.hidden && (
                <text
                  x={label.x} y={label.y} textAnchor="middle" fontSize={9.5} fontWeight={600}
                  fill="var(--color-on-surface-variant)" paintOrder="stroke"
                  stroke="var(--color-surface-container-low)" strokeWidth={3}
                >
                  {label.text}
                </text>
              )}
            </g>
          );
        })}

        {/* Markers first, then labels in a second pass, so a label never sits
            hidden underneath a later, larger marker (real risk with same-state
            stores this close together on a national-scale map). */}
        {points.map((p) => {
          const dimmed = searchActive && !matches(p);
          return (
            <g
              key={p.store}
              onMouseEnter={() => setHover(p.store)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
              opacity={dimmed ? 0.25 : 1}
            >
              {p.store === highlightStore && (
                <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke="var(--color-on-surface)" strokeWidth={2} strokeDasharray="3,2" />
              )}
              <circle
                cx={p.x} cy={p.y} r={p.r}
                fill={p.fill}
                opacity={hover && hover !== p.store ? 0.4 : 0.9}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          );
        })}

        {points.map((p) => {
          const dimmed = searchActive && !matches(p);
          const label = storeLabelByStore[p.store];
          const y = label?.dy === "farBelow" ? p.y + p.r + 27 : label?.dy === "below" ? p.y + p.r + 13 : p.y - p.r - 5;
          return (
            <g key={`${p.store}-label`} pointerEvents="none" opacity={dimmed ? 0.25 : 1}>
              <text
                x={p.x}
                y={y}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--color-on-surface)"
                opacity={hover && hover !== p.store ? 0.35 : 1}
                paintOrder="stroke"
                stroke="var(--color-surface-container-low)"
                strokeWidth={3}
              >
                {p.store}
              </text>
            </g>
          );
        })}

        {hovered && (
          <g transform={`translate(${Math.min(Math.max(hovered.x - 90, padding.left), width - padding.right - 180)}, ${Math.max(hovered.y - 90, padding.top)})`}>
            <rect
              width={180}
              height={44 + hoveredLanes.length * 16}
              rx={6}
              fill="var(--color-surface-container-high)"
              stroke="var(--color-outline-variant)"
            />
            <text x={10} y={18} fontSize={12} fontWeight={700} fill="var(--color-on-surface)">
              {hovered.store} — {hovered.city}
            </text>
            <text x={10} y={34} fontSize={11} fill="var(--color-on-surface-variant)">
              {hovered.critical_items} Critical item{hovered.critical_items === 1 ? "" : "s"}
            </text>
            {hoveredLanes.map((l, i) => (
              <text key={i} x={10} y={50 + i * 16} fontSize={10.5} fill="var(--color-on-surface-variant)">
                {l.origin_store === hovered.store ? "→" : "←"} {l.origin_store === hovered.store ? l.destination_store : l.origin_store}
                {"  "}({l.distance_miles.toLocaleString()} mi, {l.item_count} items)
              </text>
            ))}
          </g>
        )}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-on-surface-variant">
        {colorMode === "state" ? (
          Object.entries(STATE_COLOR).map(([state, color]) => (
            <span key={state} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {state}
            </span>
          ))
        ) : (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-8 rounded-full"
              style={{ background: `linear-gradient(to right, ${riskColor(0)}, ${riskColor(1)})` }}
            />
            Fewer → more Critical items
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-on-surface" />
          Your store
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-outline" />
          Active transfer route
        </span>
        <span>Marker size = Critical items at that store</span>
      </div>
    </div>
  );
}
