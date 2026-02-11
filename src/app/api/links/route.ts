import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const martCode = request.nextUrl.searchParams.get("mart_code")?.trim() ?? "";
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  let query = client
    .from("links")
    .select("created_at, campaign_name, short_url, mart_code, ad_creative, airbridge_link_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (martCode) {
    query = query.eq("mart_code", martCode);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, message: "링크 이력 조회 실패", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: data ?? [],
  });
}
