"use client";
import type { WikiData } from "@/lib/surfaces/wiki";
import { Chips, useSection } from "./kit";
import type { SurfaceViewProps } from "../surface";

export function WikiView({ data, busy, live, send }: SurfaceViewProps<never, WikiData>) {
  const { open, toggle } = useSection<"more">();
  const sentences = data.extract.split(/(?<=\.)\s+/);
  return (
    <div>
      <div className="flex gap-4 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail, already sized by Wikipedia */}
        {data.image && <img src={data.image} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-16 sm:w-16" />}
        <div className="min-w-0 space-y-1">
          <div className="text-lg font-medium leading-snug tracking-tight">{data.title}</div>
          {data.description && <div className="text-xs text-mute">{data.description}</div>}
          <p className="text-sm leading-relaxed">{open === "more" ? data.extract : sentences.slice(0, 2).join(" ")}</p>
          {data.ambiguous && <p className="text-xs text-mute">This title has several meanings: say which one you mean.</p>}
        </div>
      </div>
      <Chips send={send} live={live} busy={busy} items={[
        sentences.length > 2 && { label: open === "more" ? "Less" : "Read more", onClick: toggle("more") },
        { label: "Wikipedia", href: data.url },
        { label: "Key facts", prompt: `Give me the key facts about ${data.title}.` },
      ]} />
    </div>
  );
}
