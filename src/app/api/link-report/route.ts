import { NextRequest, NextResponse } from "next/server";

import { getLinkReport } from "@/lib/linkReport";

export async function GET(request: NextRequest) {
  const shortUrl = request.nextUrl.searchParams.get("short_url")?.trim() ?? "";
  const airbridgeLinkId = request.nextUrl.searchParams.get("airbridge_link_id")?.trim() ?? "";
  const requestedTaskId = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!shortUrl && !airbridgeLinkId) {
    return NextResponse.json(
      { success: false, message: "short_url 또는 airbridge_link_id가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const data = await getLinkReport({
      shortUrl,
      airbridgeLinkId,
      requestedTaskId,
      forceRefresh,
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge 리포트 조회 실패",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
