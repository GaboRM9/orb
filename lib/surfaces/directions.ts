import { z } from "zod";
import { defineSurface } from "./define";
import { formatDistance, formatDuration } from "./format";

// ponytail: OpenStreetMap's free services (Nominatim for places, FOSSGIS OSRM for routes) are fair-use, about 1 request/s
// and no SLA. Fine for development; swap these two functions for a paid provider before real traffic.
const UA = "orb-chat/0.1 (directions surface)"; // Nominatim requires an identifying User-Agent
const PROFILE = { walk: "routed-foot", bike: "routed-bike", drive: "routed-car" } as const;

export type Place = { name: string; lat: number; lng: number };
export type DirectionsData = {
  from: Place;
  to: Place;
  distanceM: number;
  durationS: number;
  line: [number, number][]; // [lat, lng]
  steps: { text: string; distanceM: number }[];
};

const get = async (url: string) => {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
};

// Nominatim's policy: at most one request per second, and cache what you get. A mode switch or Reverse reuses both places.
// ponytail: per server instance and lost on restart; a shared store if there are many instances.
const places = new Map<string, Promise<Place>>();
const MAX_PLACES = 500;
let nextSlot = 0;
const nominatimTurn = () => {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1000; // claim the next free second before waiting, so concurrent calls queue up
  return new Promise((r) => setTimeout(r, wait));
};

export function geocode(q: string): Promise<Place> {
  const key = q.trim().toLowerCase();
  const cached = places.get(key);
  if (cached) return cached;
  const p = (async () => {
    await nominatimTurn();
    const [hit] = (await get(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)) as { display_name: string; lat: string; lon: string }[];
    if (!hit) throw new Error(`Couldn't find "${q}"`);
    return { name: hit.display_name.split(",").slice(0, 2).join(",").trim(), lat: +hit.lat, lng: +hit.lon };
  })();
  places.set(key, p);
  p.catch(() => places.delete(key)); // a failure isn't cached: the next try asks again
  if (places.size > MAX_PLACES) places.delete(places.keys().next().value!); // oldest first
  return p;
}

type OsrmStep = { name: string; distance: number; maneuver: { type: string; modifier?: string } };
/** "Turn left onto Gran Vía": OSRM gives a maneuver type, a direction and a street name. */
export function stepText({ name, maneuver: { type, modifier } }: OsrmStep) {
  const onto = name ? ` onto ${name}` : "";
  const dir = modifier && modifier !== "straight" ? modifier : "";
  if (type === "depart") return `Head out${name ? ` on ${name}` : ""}`;
  if (type === "arrive") return "Arrive";
  if (type === "roundabout" || type === "rotary") return `Take the roundabout${onto}`;
  if (type === "turn" || type === "end of road" || type === "fork") return dir ? `${type === "fork" ? "Keep" : "Turn"} ${dir}${onto}` : `Continue${onto}`;
  return `${dir ? `Go ${dir}` : "Continue"}${onto}`; // continue, new name, merge, on/off ramp…
}

export const directions = defineSurface({
  name: "directions",
  title: "Directions",
  when: "the user wants to get somewhere, or asks how far or how long it takes between two places",
  params: z.object({
    from: z.string().min(2).max(120).describe("start: an address or place name, as specific as you can (include the city)"),
    to: z.string().min(2).max(120).describe("destination, same rules"),
    mode: z.enum(["walk", "bike", "drive"]).default("walk"),
  }),
  async fetch({ from, to, mode }): Promise<DirectionsData> {
    const [a, b] = await Promise.all([geocode(from), geocode(to)]); // cached, and spaced a second apart when not
    const r = (await get(`https://routing.openstreetmap.de/${PROFILE[mode]}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson&steps=true`)) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[];
    };
    const route = r.routes?.[0];
    if (r.code !== "Ok" || !route) throw new Error(`No ${mode} route between those places`);
    return {
      from: a,
      to: b,
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      steps: route.legs[0].steps.slice(0, 60).map((s) => ({ text: stepText(s), distanceM: Math.round(s.distance) })),
    };
  },
  summary: ({ mode }, d) => `${formatDuration(d.durationS)} ${{ walk: "walk", bike: "by bike", drive: "drive" }[mode]}, ${formatDistance(d.distanceM)}, ${d.from.name} → ${d.to.name}`,
});
