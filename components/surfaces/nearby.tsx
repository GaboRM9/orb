"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { formatDistance } from "@/lib/surfaces/format";
import type { KINDS, NearbyData, NearbyPlace } from "@/lib/surfaces/nearby";
import { Chips, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

type Kind = (typeof KINDS)[number];
type Params = { near: string; kind: Kind };
const SHOWN = 3;
// what people look for next: a switch is a refetch, no model call
const RELATED: Record<Kind, Kind[]> = {
  cafe: ["restaurant", "bar", "supermarket"], restaurant: ["cafe", "bar", "atm"], bar: ["restaurant", "cafe", "atm"],
  pharmacy: ["hospital", "supermarket", "atm"], supermarket: ["pharmacy", "atm", "cafe"], atm: ["supermarket", "pharmacy", "cafe"],
  park: ["cafe", "restaurant", "bar"], hotel: ["restaurant", "cafe", "atm"], hospital: ["pharmacy", "atm", "cafe"], fuel: ["atm", "supermarket", "cafe"],
};

export function NearbyView({ params, data, refetch, busy, live, send }: SurfaceViewProps<Params, NearbyData>) {
  const [picked, setPicked] = useState(0);
  const { open, toggle } = useSection<"map" | "all">();
  const p = data.places[picked];
  const rows = open === "all" ? data.places : data.places.slice(0, SHOWN);
  return (
    <div>
      {open === "map" && <PlacesMap data={data} picked={picked} onPick={setPicked} />}
      {data.places.length ? (
        <ol className="space-y-0.5 p-4 pb-3">
          {rows.map((x, i) => <Row key={`${x.lat},${x.lng}`} place={x} on={i === picked} onClick={() => setPicked(i)} />)}
        </ol>
      ) : (
        <p className="p-4 text-sm text-mute">No {params.kind} within about 1 km.</p>
      )}
      <Chips send={send} live={live} busy={busy} items={[
        data.places.length > 0 && { label: "Map", pressed: open === "map", onClick: toggle("map") },
        data.places.length > SHOWN && { label: `All ${data.places.length}`, pressed: open === "all", onClick: toggle("all") },
        ...RELATED[params.kind].map((k) => ({ label: k, onClick: () => (setPicked(0), refetch({ ...params, kind: k })) })),
        p && { label: `Directions to ${p.name}`, prompt: `How do I get from ${data.center.name} to ${p.name}${p.address ? `, ${p.address}` : ""}?` },
      ]} />
    </div>
  );
}

const Row = ({ place, on, onClick }: { place: NearbyPlace; on: boolean; onClick: () => void }) => (
  <li>
    <button className={`row-hover flex w-full items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm ${on ? "bg-surface-2" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="min-w-0 truncate">{place.name}</span>
      <span className="shrink-0 font-mono text-xs text-mute">{formatDistance(place.distanceM)}</span>
    </button>
  </li>
);

/** Same Leaflet setup as the directions map: the centre as a ring, places as dots, the picked one filled. */
function PlacesMap({ data, picked, onPick }: { data: NearbyData; picked: number; onPick: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const dots = useRef<import("leaflet").CircleMarker[]>([]);
  useEffect(() => {
    let gone = false;
    import("leaflet").then((L) => {
      if (gone || !box.current) return;
      const m = (map.current = L.map(box.current, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile }));
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      L.circleMarker([data.center.lat, data.center.lng], { className: "route-dot", radius: 7, weight: 3 }).addTo(m);
      dots.current = data.places.map((p, i) => L.circleMarker([p.lat, p.lng], { className: "place-dot", radius: 5, weight: 2, fillOpacity: 0.2 }).on("click", () => onPick(i)).addTo(m));
      const all = [data.center, ...data.places].map((p) => [p.lat, p.lng] as [number, number]);
      m.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 17 });
    });
    return () => {
      gone = true;
      map.current?.remove();
      map.current = null;
    };
  }, [data, onPick]);
  useEffect(() => {
    dots.current.forEach((d, i) => d.setStyle({ fillOpacity: i === picked ? 1 : 0.2 })); // the colour comes from .place-dot
    const p = data.places[picked];
    if (p && map.current) map.current.panTo([p.lat, p.lng]);
  }, [picked, data]);
  return <div ref={box} className="route-map h-40 w-full border-b border-line" role="img" aria-label={`Map of places near ${data.center.name}`} />;
}
