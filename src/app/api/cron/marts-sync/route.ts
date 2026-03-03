import { NextRequest, NextResponse } from "next/server";

import { POST as syncMarts } from "@/app/api/marts/sync/route";

export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return {
      ok: false,
      message:
        "CRON_SECRET 환경변수가 설정되지 않았습니다. Vercel 프로젝트 환경변수에 CRON_SECRET을 추가하세요.",
    };
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      message: "Unauthorized cron request",
    };
  }

  return { ok: true, message: "" };
}

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        success: false,
        message: auth.message,
      },
      { status: 401 },
    );
  }

  // Reuse the same sync logic as UI button.
  return syncMarts();
}
