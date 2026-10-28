"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { DirectionsData } from "@/lib/surfaces/directions";
import { formatDistance, formatDuration } from "@/lib/surfaces/format";
import { Chips, Hero, More, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

type Params = { from: string; to: string; mode: "walk" | "bike" | "drive" };
const MODES = [["walk", "Walk"], ["bike", "Bike"], ["drive", "Drive"]] as const;
const OSM_ENGINE = { walk: "fossgis_osrm_foot", bike: "fossgis_osrm_bike", drive: "fossgis_osrm_car" } as const;

export function DirectionsView({ params, data, refetch, busy, live, send }: SurfaceViewProps<Params, DirectionsData>) {
  const { open, toggle } = useSection<"steps">();
  const osm = `https://www.openstreetmap.org/directions?engine=${OSM_ENGINE[params.mode]}&route=${data.from.lat},${data.from.lng};${data.to.lat},${data.to.lng}`;
  return (
    <div>
      <RouteMap data={data} />
      <Hero value={formatDuration(data.durationS)} detail={`${formatDistance(data.distanceM)} · ${data.from.name} → ${data.to.name}`} />
      {/* a mode switch or Reverse is a refresh: new data in place, no message to the agent */}
      <Chips send={send} live={live} busy={busy} items={[
        ...MODES.map(([m, label]) => ({ label, pressed: params.mode === m, onClick: () => params.mode !== m && refetch({ ...params, mode: m }) })),
        { label: "Reverse", onClick: () => refetch({ ...params, from: params.to, to: params.from }) },
        { label: "Steps", pressed: open === "steps", onClick: toggle("steps") },
        { label: "Open in Maps", href: osm },
      ]} />
      {open === "steps" && (
        <More>
          <ol className="space-y-1.5 text-sm">
            {data.steps.map((s, n) => (
              <li key={n} className="flex justify-between gap-4">
                <span>{s.text}</span>
                {s.distanceM > 0 && <span className="shrink-0 font-mono text-xs text-mute">{formatDistance(s.distanceM)}</span>}
              </li>
            ))}
          </ol>
        </More>
      )}
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
      // the map sits inside a scrolling chat: wheel and (on touch) one-finger drags scroll the page; pinch still pans and zooms
      map = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile });
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
  return <div ref={box} className="route-map h-40 w-full border-b border-line" role="img" aria-label={`Map of the route from ${data.from.name} to ${data.to.name}`} />;
}
