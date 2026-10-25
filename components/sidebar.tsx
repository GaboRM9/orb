"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./avatar";
import { BotIcon, ChatIcon, GearIcon, ZapIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";

type Thread = { id: string; title: string; agent_id: string | null };
type Agent = { id: string; name: string };

const nav = [["Chat", "/chat", ChatIcon], ["Agents", "/agents", BotIcon], ["Skills", "/skills", ZapIcon], ["Settings", "/settings", GearIcon]] as const;

export function Sidebar({ threads, agents }: { threads: Thread[]; agents: Agent[] }) {
  const path = usePathname();
  const openThread = threads.find((t) => path === `/chat/${t.id}`);
  const item = (on: boolean) => `block truncate px-2 py-1.5 text-sm transition-colors ${on ? "text-fg" : "text-mute hover:text-fg"}`;
  const sub = "ml-3 flex flex-col gap-0.5 border-l border-line pl-2";
  // an open conversation highlights its agent's row; the Agents tab itself is "on" only on /agents pages
  const on = (href: string) => (href === "/chat" ? (openThread ? !openThread.agent_id : path === "/chat") : path.startsWith(href));
  return (
    <aside className="flex w-56 shrink-0 flex-col justify-between border-r border-line p-3">
      <div className="flex min-h-0 flex-col">
        <div className="mb-8 px-2 text-xs font-medium uppercase tracking-[0.2em]">AI Showcase</div>
        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {nav.map(([label, href, Icon]) => (
            <div key={href} className="flex min-h-0 flex-col gap-0.5">
              <Link href={href} className={`${item(on(href))} flex items-center gap-2.5 ${on(href) ? "border-l border-fg" : "border-l border-transparent"}`}><Icon /> {label}</Link>
              {href === "/agents" && (
                <div className={sub}>
                  {agents.map((a) => (
                    <Link key={a.id} href={`/agents/${a.id}`} className={`${item(openThread?.agent_id === a.id)} flex items-center gap-2 !py-1 text-xs`}>
                      <Avatar name={a.name} size="h-4 w-4 text-[9px]" /> {a.name}
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
