import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET() {
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

  const totalRes = await client.from("marts").select("code", { head: true, count: "exact" });
  if (totalRes.error) {
    return NextResponse.json(
      { success: false, message: "마트 통계 조회 실패", detail: totalRes.error.message },
      { status: 500 },
    );
  }

  const enabledRes = await client
    .from("marts")
    .select("code", { head: true, count: "exact" })
    .eq("enabled", true);
  if (enabledRes.error) {
    if (enabledRes.error.message.includes("enabled") || enabledRes.error.message.includes("column")) {
      const total = totalRes.count ?? 0;
      return NextResponse.json({
        success: true,
        data: {
          total,
          enabled: total,
          disabled: 0,
        },
      });
    }
    return NextResponse.json(
      { success: false, message: "마트 통계 조회 실패", detail: enabledRes.error.message },
      { status: 500 },
    );
  }

  const disabledRes = await client
    .from("marts")
    .select("code", { head: true, count: "exact" })
    .eq("enabled", false);
  if (disabledRes.error) {
    return NextResponse.json(
      { success: false, message: "마트 통계 조회 실패", detail: disabledRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      total: totalRes.count ?? 0,
      enabled: enabledRes.count ?? 0,
      disabled: disabledRes.count ?? 0,
    },
  });
}
