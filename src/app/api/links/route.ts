import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const martCode = request.nextUrl.searchParams.get("mart_code")?.trim() ?? "";
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const adCreative = request.nextUrl.searchParams.get("ad_creative")?.trim() ?? "";
  const dateFrom = request.nextUrl.searchParams.get("date_from")?.trim() ?? "";
  const dateTo = request.nextUrl.searchParams.get("date_to")?.trim() ?? "";
  const offsetRaw = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
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
    .range(offset, offset + limit - 1);

  if (martCode) {
    query = query.eq("mart_code", martCode);
  }
  if (adCreative) {
    query = query.eq("ad_creative", adCreative);
  }
  if (dateFrom) {
    query = query.gte("created_at", `${dateFrom}T00:00:00`);
  }
  if (dateTo) {
    query = query.lte("created_at", `${dateTo}T23:59:59.999`);
  }
  if (q) {
    const safeQ = q.replace(/[,%()]/g, " ").trim();
    query = query.or(
      `campaign_name.ilike.%${safeQ}%,short_url.ilike.%${safeQ}%,mart_code.ilike.%${safeQ}%`,
    );
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
    paging: {
      limit,
      offset,
      has_more: (data ?? []).length === limit,
    },
  });
}
