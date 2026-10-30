import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { Viewport } from "@/components/viewport";
import { getSetting, listThreads, session } from "@/lib/db";
import { waitingApprovals } from "@/lib/runs";
import { parseTheme, themeStyle } from "@/lib/theme";
import "./globals.css";

export const dynamic = "force-dynamic"; // sidebar lists saved chats

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "orb", description: "A calm, minimal agent workspace" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const s = await session(); // no session, no sidebar data in the HTML
  const authed = !!s;
  const [threads, waiting] = s ? await Promise.all([listThreads(), waitingApprovals(s.uid)]) : [[], []];
  // the theme is rendered into the HTML, so the first paint is already right; signed out there's no workspace, so the default
  const theme = parseTheme(authed ? await getSetting("theme", "{}") : "{}");
  return (
    <html lang="en" data-mode={theme.mode} style={themeStyle(theme)} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full flex-col overscroll-none md:flex-row">
        <Viewport />
        {authed && <Sidebar threads={threads} waiting={waiting.length} />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
