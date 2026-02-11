import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

function isTemplateValue(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.startsWith("__PUT_") ||
    normalized.includes("PUT_YOUR") ||
    normalized.includes("YOUR_")
  );
}

export async function POST(request: Request) {
  const adminKey = process.env.ADMIN_CLEAR_KEY?.trim();
  if (isTemplateValue(adminKey)) {
    return NextResponse.json(
      { success: false, message: "ADMIN_CLEAR_KEY가 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { key?: string };
  const providedKey = body.key?.trim() ?? "";
  if (!providedKey || providedKey !== adminKey) {
    return NextResponse.json(
      { success: false, message: "관리자 키가 올바르지 않습니다." },
      { status: 401 },
    );
  }

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

  const countBefore = await client
    .from("links")
    .select("*", { count: "exact", head: true });
  if (countBefore.error) {
    return NextResponse.json(
      { success: false, message: "현재 이력 카운트 조회 실패", detail: countBefore.error.message },
      { status: 500 },
    );
  }

  const deleteResult = await client.from("links").delete().neq("short_url", "");
  if (deleteResult.error) {
    return NextResponse.json(
      { success: false, message: "이력 초기화 실패", detail: deleteResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    summary: {
      deleted: countBefore.count ?? 0,
    },
  });
}
