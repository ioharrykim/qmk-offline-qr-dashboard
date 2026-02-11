import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const includeDisabled =
    request.nextUrl.searchParams.get("include_disabled") === "1" ||
    request.nextUrl.searchParams.get("include_disabled") === "true";

  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      {
        success: false,
        message: `Supabase env 누락: ${missingEnvKeys.join(", ")}`,
      },
      { status: 400 },
    );
  }

  let query = client
    .from("marts")
    .select("name, code, enabled, address, tel, manager_name, manager_tel");
  if (!includeDisabled) {
    query = query.eq("enabled", true);
  }
  if (q.length > 0) {
    query = query.ilike("name", `%${q}%`).order("name", { ascending: true }).limit(30);
  } else {
    query = query.order("name", { ascending: true }).limit(20);
  }

  let { data, error } = await query;

  if (
    error &&
    !includeDisabled &&
    (error.message.includes("enabled") || error.message.includes("column"))
  ) {
    let fallbackQuery = client
      .from("marts")
      .select("name, code")
      .order("name", { ascending: true });
    if (q.length > 0) {
      fallbackQuery = fallbackQuery.ilike("name", `%${q}%`).limit(30);
    } else {
      fallbackQuery = fallbackQuery.limit(20);
    }
    const fallback = await fallbackQuery;
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json(
      { success: false, message: "마트 검색 실패", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: data ?? [] });
}
