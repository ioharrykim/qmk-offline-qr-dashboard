import { NextRequest, NextResponse } from "next/server";

import { createOrGetSharedReport } from "@/lib/sharedReports";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    campaign_name?: string;
    label?: string | null;
    expires_at?: string | null;
  };

  const campaignName = body.campaign_name?.trim() ?? "";
  if (!campaignName) {
    return NextResponse.json(
      { success: false, message: "campaign_name이 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const sharedReport = await createOrGetSharedReport({
      campaignName,
      label: body.label?.trim() || null,
      expiresAt: body.expires_at?.trim() || null,
    });

    const shareUrl = `${request.nextUrl.origin}/share/report/${sharedReport.share_slug}`;

    return NextResponse.json({
      success: true,
      data: {
        ...sharedReport,
        share_url: shareUrl,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "공유 리포트 생성 실패",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
