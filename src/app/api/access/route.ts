import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  getAccessGateCode,
  getAccessGateTtlDays,
} from "@/lib/accessGate";

export async function POST(request: NextRequest) {
  const gateCode = getAccessGateCode();
  if (!gateCode) {
    return NextResponse.json(
      { success: false, message: "ACCESS_GATE_CODE가 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const inputCode = body.code?.trim() ?? "";
  if (inputCode !== gateCode) {
    return NextResponse.json(
      { success: false, message: "입장 코드가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  const ttlDays = getAccessGateTtlDays();
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "verified",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * ttlDays,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
