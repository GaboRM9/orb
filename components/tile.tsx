import Link from "next/link";

/** Hairline tile grid: the gap shows the container's background as 1px rules. */
export const TileGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-px border border-line bg-line sm:grid-cols-2">{children}</div>
);

export function Tile({ href, title, desc, tag, active }: { href: string; title: string; desc: string; tag?: string; active?: boolean }) {
  return (
    <Link href={href} scroll={false} className={`flex min-h-28 flex-col justify-between gap-4 bg-bg p-5 transition-colors hover:bg-fg/5 ${active ? "outline outline-1 -outline-offset-1 outline-fg" : ""}`}>
      <div className="space-y-1">
        <div className="font-mono text-sm">{title}</div>
        <p className="line-clamp-2 text-sm text-mute">{desc}</p>
      </div>
      {tag && <div className="text-xs text-mute">{tag}</div>}
    </Link>
  );
}
