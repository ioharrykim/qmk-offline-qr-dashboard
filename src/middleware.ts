import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  SHARE_ACCESS_COOKIE_NAME,
  getAccessGateCode,
  getShareGateCode,
} from "@/lib/accessGate";

const PUBLIC_PATHS = ["/enter", "/api/access", "/api/order-automation/intake", "/api/share-access"];
const SHARE_PUBLIC_PATHS = ["/share/enter"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (pathname === "/share" || pathname.startsWith("/share/")) {
    const shareGateCode = getShareGateCode();
    if (!shareGateCode) {
      return NextResponse.next();
    }

    if (
      SHARE_PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    ) {
      return NextResponse.next();
    }

    const shareGateCookie = request.cookies.get(SHARE_ACCESS_COOKIE_NAME)?.value;
    if (shareGateCookie === "verified") {
      return NextResponse.next();
    }

    const url = request.nextUrl.clone();
    url.pathname = "/share/enter";
    url.search = `next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  const gateCode = getAccessGateCode();
  if (!gateCode) {
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
