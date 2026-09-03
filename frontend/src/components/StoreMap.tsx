"use client";

import "leaflet/dist/leaflet.css";
import { useMemo, useState } from "react";
import L from "leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Tooltip, Popup } from "react-leaflet";
import { StoreMapLane, StoreMapPoint } from "@/lib/api";

/**
 * A real map - OpenStreetMap tiles via Leaflet, real lat/lon per store's
 * disclosed stand-in city, real projection (Leaflet/Web Mercator instead of
 * this project's earlier hand-rolled equirectangular sketch). Stores are
 * classic map-pin markers (not plain dots) sized by real Critical item
 * count, sitting on a small ground-shadow ellipse.
 *
 * Transfer lanes are real (scripts/07 + 08) but are NOT drawn by default
 * any more - with up to 6 lanes touching 10 stores, permanent lines read as
 * clutter before you've asked about any specific store. Instead: click a
 * store's pin, and its popup lists that store's real active lane(s) as
 * "Transfer" actions; picking one draws just that route on the map. This
 * mirrors how a store associate would actually use it - "show me where
 * THIS store's stock would go" - rather than showing every route at once.
 *
 * Deliberately NOT included, because none of it is real data this project
 * has: live GPS, "couriers en route," live traffic, dock/receiving windows,
 * store contacts. See store-map/page.tsx for what replaces each of those.
 *
 * Note: OpenStreetMap's tile servers are reached directly from the
 * viewer's own browser (not this app's backend), so they load normally
 * wherever this app actually runs.
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

// A classic map-pin (teardrop + circular hole), not a plain dot - the same
// silhouette as a standard location-marker icon. Drawn as a divIcon (no
// image assets, no CDN) so its fill color can follow state/risk coloring.
const PIN_PATH =
  "M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z";

function pinIcon(fill: string, size: number, dimmed: boolean) {
  const height = Math.round(size * (512 / 384));
  const html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="${size}" height="${height}" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));opacity:${dimmed ? 0.3 : 1}"><path d="${PIN_PATH}" fill="${fill}" stroke="#fff" stroke-width="12"/></svg>`;
  return L.divIcon({
    html,
    className: "store-map-pin",
    iconSize: [size, height],
    iconAnchor: [size / 2, height],
    popupAnchor: [0, -height * 0.92],
    tooltipAnchor: [0, -height * 0.98],
  });
}

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
  const [activeLane, setActiveLane] = useState<string | null>(null);

  const query = searchQuery.trim().toLowerCase();
  const matches = (s: StoreMapPoint) =>
    query.length === 0 || s.store.toLowerCase().includes(query) || s.city.toLowerCase().includes(query);
  const searchActive = query.length > 0;

  const points = useMemo(() => {
    const maxCritical = Math.max(...stores.map((s) => s.critical_items), 1);
    return stores.map((s) => {
      const size = 26 + Math.sqrt(s.critical_items / maxCritical) * 16;
      const fill =
        colorMode === "risk" ? riskColor(s.critical_items / maxCritical) : STATE_COLOR[s.state] ?? "var(--color-outline)";
      return { ...s, size, fill, position: [s.lat, s.lon] as LatLngTuple };
    });
  }, [stores, colorMode]);

  const byStore = useMemo(() => Object.fromEntries(points.map((p) => [p.store, p])), [points]);

  const laneKey = (l: { origin_store: string; destination_store: string }) => `${l.origin_store}-${l.destination_store}`;

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
          weight: 2.5 + (l.item_count / maxCount) * 3,
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

  const activeSegment = laneSegments.find((l) => laneKey(l) === activeLane) ?? null;

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

        {activeSegment && (
          <Polyline positions={activeSegment.positions} pathOptions={{ color: activeSegment.color, weight: activeSegment.weight, lineCap: "round" }}>
            {showDistances && (
              <Tooltip permanent direction="center" className="!border-0 !bg-surface-container-low/90 !px-1 !py-0 !text-[10px] !font-semibold !text-on-surface-variant !shadow-none">
                {activeSegment.distance_miles.toLocaleString()} mi
              </Tooltip>
            )}
          </Polyline>
        )}

        {/* A small ground-shadow ellipse under every pin (matches the
            standard "pin standing on the ground" marker style); the
            logged-in user's own store gets a dashed ring here instead, so
            it doubles as the ground shadow and the "this is you" cue. */}
        {points.map((p) => {
          const dimmed = searchActive && !matches(p);
          const isYou = p.store === highlightStore;
          return (
            <CircleMarker
              key={`${p.store}-ground`}
              center={p.position}
              radius={isYou ? 12 : 5}
              pathOptions={
                isYou
                  ? { fill: false, color: "var(--color-on-surface)", weight: 2, dashArray: "3,3", opacity: dimmed ? 0.2 : 1 }
                  : { color: "transparent", fillColor: "#000", fillOpacity: dimmed ? 0.05 : 0.18, weight: 0 }
              }
              interactive={false}
            />
          );
        })}

        {points.map((p) => {
          const dimmed = searchActive && !matches(p);
          const connectedLanes = lanesByStore[p.store] ?? [];
          return (
            <Marker key={p.store} position={p.position} icon={pinIcon(p.fill, p.size, dimmed)}>
              <Tooltip permanent direction="top" offset={[0, -p.size * 0.98]} className="!border-0 !bg-transparent !p-0 !text-xs !font-semibold !text-on-surface !shadow-none">
                {p.store}
              </Tooltip>
              <Popup minWidth={200}>
                <p className="font-semibold text-on-surface">{p.store} — {p.city}</p>
                <p className="text-on-surface-variant">{p.critical_items} Critical item{p.critical_items === 1 ? "" : "s"}</p>
                <div className="mt-2 border-t border-outline-variant pt-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Transfer</p>
                  {connectedLanes.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">No active transfer lane right now.</p>
                  ) : (
                    <div className="space-y-1">
                      {connectedLanes.map((l) => {
                        const key = laneKey(l);
                        const isOrigin = l.origin_store === p.store;
                        const other = isOrigin ? l.destination_store : l.origin_store;
                        const isActive = activeLane === key;
                        return (
                          <button
                            key={key}
                            onClick={() => setActiveLane(isActive ? null : key)}
                            className={`block w-full rounded px-2 py-1 text-left text-xs font-medium ${
                              isActive ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container hover:bg-surface-container-high"
                            }`}
                          >
                            {isOrigin ? `Send to ${other}` : `Receive from ${other}`} · {l.distance_miles.toLocaleString()} mi
                            {isActive ? " (shown)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
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
        <span>Marker size = Critical items at that store · click a pin, then Transfer, to see its route</span>
      </div>
    </div>
  );
}
