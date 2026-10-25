"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./avatar";
import { BotIcon, GearIcon, OrbIcon, ZapIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";

type Thread = { id: string; title: string; agent_id: string | null };
type Agent = { id: string; name: string };

const nav = [["Agents", "/agents", BotIcon], ["Skills", "/skills", ZapIcon], ["Settings", "/settings", GearIcon]] as const;

export function Sidebar({ threads, agents }: { threads: Thread[]; agents: Agent[] }) {
  const path = usePathname();
  const openThread = threads.find((t) => path === `/chat/${t.id}`);
  const item = (on: boolean) => `block truncate px-3 py-2 text-[15px] transition-colors ${on ? "text-fg" : "text-mute hover:text-fg"}`;
  const sub = "ml-4 flex flex-col gap-0.5 border-l border-line pl-3";
  // an open conversation highlights its agent's row; the Agents tab itself is "on" only on /agents pages
  const on = (href: string) => path.startsWith(href);
  return (
    <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-line p-5">
      <div className="flex min-h-0 flex-col">
        <div className="mb-10 flex items-center gap-2.5 px-2 font-mono text-base font-light tracking-[0.3em]"><OrbIcon className="h-6 w-6" />orb</div>
        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {nav.map(([label, href, Icon]) => (
            <div key={href} className="flex min-h-0 flex-col gap-0.5">
              <Link href={href} className={`${item(on(href))} flex items-center gap-3 ${on(href) ? "border-l border-fg" : "border-l border-transparent"}`}><Icon /> {label}</Link>
              {href === "/agents" && (
                <div className={sub}>
                  {agents.map((a) => (
                    <Link key={a.id} href={`/agents/${a.id}`} className={`${item(openThread?.agent_id === a.id)} flex items-center gap-2 !py-1.5 !text-sm`}>
                      <Avatar name={a.name} size="h-5 w-5 text-[10px]" /> {a.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <ThemeToggle />
    </aside>
  );
}
