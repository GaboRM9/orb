import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifyToken } from "@/lib/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || verifyToken(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  return pathname.startsWith("/api/") ? new NextResponse("Unauthorized", { status: 401 }) : NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg).*)"] };
