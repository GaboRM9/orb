import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { isAuthed } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { listThreads } from "@/lib/db";
import "./globals.css";

export const dynamic = "force-dynamic"; // sidebar lists saved chats

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "orb", description: "A calm, minimal agent workspace" };

// Applies saved theme (or OS preference) before paint to avoid a flash.
const themeScript = `try{var t=localStorage.theme;if(t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const authed = await isAuthed(); // no session, no sidebar data in the HTML
  const threads = authed ? await listThreads() : [];
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="flex h-full flex-col md:flex-row">
        {authed && <Sidebar threads={threads} />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
