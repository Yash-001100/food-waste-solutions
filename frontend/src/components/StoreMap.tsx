"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Popup } from "react-leaflet";
import { StoreMapLane, StoreMapPoint } from "@/lib/api";

/**
 * A real map - OpenStreetMap tiles via Leaflet, real lat/lon per store's
 * disclosed stand-in city, real projection (Leaflet/Web Mercator instead of
 * this project's earlier hand-rolled equirectangular sketch). Replaces the
 * abstract flat-rectangle version: an actual map lets you zoom into a tight
 * cluster (the WI stores, or CA_2/CA_3) instead of needing custom label-
 * collision code to fake that at a fixed scale.
 *
 * The straight lines between stores are real transfer lanes (scripts/07 +
 * 08), not decoration - a line only exists here if that route is currently
 * real and cost-effective.
 *
 * Deliberately NOT included, because none of it is real data this project
 * has: live GPS, "couriers en route," live traffic, dock/receiving windows,
 * store contacts. See store-map/page.tsx for what replaces each of those.
 *
 * Note: OpenStreetMap's tile servers are reached directly from the
 * viewer's own browser (not this app's backend), so they load normally
 * wherever this app actually runs - this only fails somewhere with no
 * general internet access at all.
 */

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

const US_BOUNDS: LatLngBoundsExpression = [
  [24, -125],
  [50, -66],
];

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
  const query = searchQuery.trim().toLowerCase();
  const matches = (s: StoreMapPoint) =>
    query.length === 0 || s.store.toLowerCase().includes(query) || s.city.toLowerCase().includes(query);
  const searchActive = query.length > 0;

  const points = useMemo(() => {
    const maxCritical = Math.max(...stores.map((s) => s.critical_items), 1);
    return stores.map((s) => {
      const radius = 7 + Math.sqrt(s.critical_items / maxCritical) * 12;
      const fill =
        colorMode === "risk" ? riskColor(s.critical_items / maxCritical) : STATE_COLOR[s.state] ?? "var(--color-outline)";
      return { ...s, radius, fill, position: [s.lat, s.lon] as LatLngTuple };
    });
  }, [stores, colorMode]);

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
          positions: [a.position, b.position] as LatLngTuple[],
          weight: 1.5 + (l.item_count / maxCount) * 3,
          color: colorMode === "risk" ? "var(--color-outline)" : STATE_COLOR[a.state] ?? "var(--color-outline)",
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [lanes, byStore, colorMode]);

  const lanesByStore = useMemo(() => {
    const map: Record<string, typeof laneSegments> = {};
    for (const l of laneSegments) {
      (map[l.origin_store] ??= []).push(l);
      (map[l.destination_store] ??= []).push(l);
    }
    return map;
  }, [laneSegments]);

  return (
    <div>
      <MapContainer
        bounds={US_BOUNDS}
        boundsOptions={{ padding: [20, 20] }}
        scrollWheelZoom
        style={{ height: 440, width: "100%", borderRadius: 8 }}
        className="border border-outline-variant"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {laneSegments.map((l) => (
          <Polyline key={`${l.origin_store}-${l.destination_store}`} positions={l.positions} pathOptions={{ color: l.color, weight: l.weight, lineCap: "round" }}>
            {showDistances && (
              <Tooltip permanent direction="center" className="!border-0 !bg-surface-container-low/90 !px-1 !py-0 !text-[10px] !font-semibold !text-on-surface-variant !shadow-none">
                {l.distance_miles.toLocaleString()} mi
              </Tooltip>
            )}
          </Polyline>
        ))}

        {points.map((p) => {
          const dimmed = searchActive && !matches(p);
          const connectedLanes = lanesByStore[p.store] ?? [];
          return (
            <CircleMarker
              key={p.store}
              center={p.position}
              radius={p.radius}
              pathOptions={{
                color: "var(--color-surface)",
                weight: 2,
                fillColor: p.fill,
                fillOpacity: dimmed ? 0.2 : 0.9,
                opacity: dimmed ? 0.2 : 1,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -p.radius]} className="!border-0 !bg-transparent !p-0 !text-xs !font-semibold !text-on-surface !shadow-none">
                {p.store}
              </Tooltip>
              <Popup>
                <p className="font-semibold">{p.store} — {p.city}</p>
                <p>{p.critical_items} Critical item{p.critical_items === 1 ? "" : "s"}</p>
                {connectedLanes.map((l) => (
                  <p key={`${l.origin_store}-${l.destination_store}`}>
                    {l.origin_store === p.store ? "→" : "←"} {l.origin_store === p.store ? l.destination_store : l.origin_store}
                    {" "}({l.distance_miles.toLocaleString()} mi, {l.item_count} items)
                  </p>
                ))}
              </Popup>
            </CircleMarker>
          );
        })}

        {highlightStore && byStore[highlightStore] && (
          <CircleMarker
            center={byStore[highlightStore].position}
            radius={byStore[highlightStore].radius + 5}
            pathOptions={{ fill: false, color: "var(--color-on-surface)", weight: 2, dashArray: "3,4" }}
            interactive={false}
          />
        )}
      </MapContainer>

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
        <span>Marker size = Critical items at that store · click a marker for detail</span>
      </div>
    </div>
  );
}
