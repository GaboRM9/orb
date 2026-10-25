import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Expands any IPv6 text form (including "::" and a dotted IPv4 tail) into 8 numeric 16-bit groups. */
function expandV6(ip: string): number[] {
  let x = ip.toLowerCase();
  const tail = x.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) x = x.slice(0, tail.index) + ((+tail[1] << 8) | +tail[2]).toString(16) + ":" + ((+tail[3] << 8) | +tail[4]).toString(16);
  const [head, rest] = x.split("::");
  const h = head ? head.split(":") : [];
  const r = rest === undefined ? [] : rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill("0");
  return [...h, ...fill, ...r].map((n) => parseInt(n, 16));
}

/** True for loopback, private, link-local (cloud metadata), CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const g = expandV6(ip);
    const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
    if ((zeros(5) && g[5] === 0xffff) || zeros(6)) return isPrivateAddress(embedded) || zeros(7); // IPv4-mapped / compatible (::, ::1 covered)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(embedded); // NAT64
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00; // ULA, link-local, multicast
  }
  return true; // not an IP at all: refuse
}

/** Throws unless the URL is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
    throw new Error("Refusing to fetch a private or internal address");
  return u;
}

/**
 * Fetch with SSRF guards: public addresses only, redirects re-validated per hop, capped body.
 * ponytail: DNS can change between this check and the connect (rebinding); pin the resolved IP via a custom dispatcher if that matters.
 */
export async function safeFetchText(raw: string, maxChars = 2000, hops = 3): Promise<string> {
  let url = raw;
  for (let i = 0; i <= hops; i++) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, u).toString();
      continue;
    }
    // read at most ~64KB so a huge response can't exhaust memory
    const reader = res.body?.getReader();
    let text = "";
    const dec = new TextDecoder();
    while (reader && text.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    await reader?.cancel().catch(() => {});
    return text.slice(0, maxChars);
  }
  throw new Error("Too many redirects");
}
