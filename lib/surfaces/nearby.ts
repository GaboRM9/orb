import { z } from "zod";
import { defineSurface } from "./define";
import { geocode, get, nominatimTurn, type Place } from "./directions";

// Nominatim's amenity search inside a ~1 km box (Overpass is richer but its public servers are often at capacity).
// ponytail: two fair-use Nominatim calls per open, spaced a second apart; a paid places API before real traffic.
export const KINDS = ["cafe", "restaurant", "bar", "pharmacy", "supermarket", "atm", "park", "hotel", "hospital", "fuel"] as const;
const BOX_DEG = 0.009; // ~1 km of latitude

export type NearbyPlace = Place & { distanceM: number; address: string };
export type NearbyData = { center: Place; places: NearbyPlace[] };

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(h)));
}

export const nearby = defineSurface({
  name: "nearby",
  title: "Nearby",
  when: "finding places close to somewhere (cafes, pharmacies, ATMs…); near is an address or place with its city",
  params: z.object({ near: z.string().min(2).max(120), kind: z.enum(KINDS) }),
  async fetch({ near, kind }): Promise<NearbyData> {
    const center = await geocode(near);
    const dLng = BOX_DEG / Math.cos((center.lat * Math.PI) / 180);
    const box = [center.lng - dLng, center.lat + BOX_DEG, center.lng + dLng, center.lat - BOX_DEG].join(",");
    await nominatimTurn();
    const hits = (await get(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&viewbox=${box}&q=${encodeURIComponent(kind)}`)) as {
      name: string; type: string; lat: string; lon: string; display_name: string;
    }[];
    const places = hits
      .map((h) => {
        const p = { lat: +h.lat, lng: +h.lon };
        return { ...p, name: h.name || h.type, distanceM: distanceM(center, p), address: h.display_name.split(",").slice(1, 3).join(",").trim() };
      })
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 20);
    return { center, places };
  },
  summary: ({ kind }, d) =>
    d.places.length ? `${d.places.length} × ${kind} near ${d.center.name}; closest: ${d.places[0].name} (${d.places[0].distanceM} m)` : `No ${kind} found within ~1 km of ${d.center.name}`,
});
