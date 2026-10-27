"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { DirectionsData } from "@/lib/surfaces/directions";
import { formatDistance, formatDuration } from "@/lib/surfaces/format";
import type { SurfaceViewProps } from "../surface";

type Params = { from: string; to: string; mode: "walk" | "bike" | "drive" };
const MODES = [["walk", "Walk"], ["bike", "Bike"], ["drive", "Drive"]] as const;
const OSM_ENGINE = { walk: "fossgis_osrm_foot", bike: "fossgis_osrm_bike", drive: "fossgis_osrm_car" } as const;

export function DirectionsView({ params, data, refetch, busy }: SurfaceViewProps<Params, DirectionsData>) {
  const osm = `https://www.openstreetmap.org/directions?engine=${OSM_ENGINE[params.mode]}&route=${data.from.lat},${data.from.lng};${data.to.lat},${data.to.lng}`;
  return (
    <div>
      <RouteMap data={data} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-light tracking-tight">{formatDuration(data.durationS)}</div>
            <div className="text-xs text-mute">{formatDistance(data.distanceM)} · {data.from.name} → {data.to.name}</div>
          </div>
          {/* a mode switch is a refresh: new data in place, no message to the agent */}
          <div className="seg">
            {MODES.map(([m, label]) => (
              <button key={m} aria-pressed={params.mode === m} disabled={busy} onClick={() => params.mode !== m && refetch({ ...params, mode: m })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <button className="btn !py-1.5 text-xs" disabled={busy} onClick={() => refetch({ ...params, from: params.to, to: params.from })}>Reverse</button>
          <a className="btn !py-1.5 text-xs" href={osm} target="_blank" rel="noopener noreferrer">Open in OpenStreetMap</a>
          <details className="peek w-full">
            <summary>{data.steps.length} steps</summary>
            <ol className="card mt-2 space-y-1.5 !p-3 text-sm">
              {data.steps.map((s, n) => (
                <li key={n} className="flex justify-between gap-4">
                  <span>{s.text}</span>
                  {s.distanceM > 0 && <span className="shrink-0 font-mono text-xs text-mute">{formatDistance(s.distanceM)}</span>}
                </li>
              ))}
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}

/** Leaflet touches window, so it loads in an effect; the line and the two dots redraw whenever the route changes. */
function RouteMap({ data }: { data: DirectionsData }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let gone = false;
    import("leaflet").then((L) => {
      if (gone || !box.current) return;
      map = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      const line = L.polyline(data.line, { className: "route-line", weight: 5 }).addTo(map);
      for (const p of [data.from, data.to]) L.circleMarker([p.lat, p.lng], { className: "route-dot", radius: 6, weight: 3 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    });
    return () => {
      gone = true;
      map?.remove();
    };
  }, [data]);
  return <div ref={box} className="route-map h-64 w-full border-b border-line" role="img" aria-label={`Map of the route from ${data.from.name} to ${data.to.name}`} />;
}
