import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { getSetting, listThreads, session } from "@/lib/db";
import { parseTheme, themeStyle } from "@/lib/theme";
import "./globals.css";

export const dynamic = "force-dynamic"; // sidebar lists saved chats

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "orb", description: "A calm, minimal agent workspace" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const authed = !!(await session()); // no session, no sidebar data in the HTML
  const threads = authed ? await listThreads() : [];
  // the theme is rendered into the HTML, so the first paint is already right; signed out there's no workspace, so the default
  const theme = parseTheme(authed ? await getSetting("theme", "{}") : "{}");
  return (
    <html lang="en" data-mode={theme.mode} style={themeStyle(theme)} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full flex-col md:flex-row">
        {authed && <Sidebar threads={threads} />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
