import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const campaign = request.nextUrl.searchParams.get("campaign")?.trim() ?? "";

  if (!campaign) {
    return NextResponse.json(
      { success: false, message: "campaign 파라미터가 필요합니다." },
      { status: 400 },
    );
  }

  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      {
        success: false,
        message: "Supabase env가 설정되지 않았습니다.",
        detail: missingEnvKeys.join(", "),
      },
      { status: 500 },
    );
  }

  const { data, error } = await client
    .from("links")
    .select(
      "campaign_name, short_url, created_at, mart_code, ad_creative, airbridge_link_id",
    )
    .eq("campaign_name", campaign)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: "캠페인 링크 조회 실패",
        detail: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        message: "해당 캠페인 링크를 찾을 수 없습니다.",
        detail: campaign,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    data,
  });
}
