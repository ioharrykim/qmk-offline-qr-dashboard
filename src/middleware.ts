import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME, getAccessGateCode } from "@/lib/accessGate";

const PUBLIC_PATHS = ["/enter", "/api/access"];

export function middleware(request: NextRequest) {
  const gateCode = getAccessGateCode();
  if (!gateCode) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const gateCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (gateCookie === "verified") {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/enter";
  url.search = `next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
