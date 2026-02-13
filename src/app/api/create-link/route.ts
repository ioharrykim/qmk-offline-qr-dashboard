import { NextResponse } from "next/server";

import { createLinkRecord, LinkServiceError } from "@/lib/linkService";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type CreateLinkBody = {
  mart_code?: string;
  ad_creative?: string;
};

export async function POST(request: Request) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  let body: CreateLinkBody;

  try {
    body = (await request.json()) as CreateLinkBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "잘못된 요청 본문입니다." },
      { status: 400 },
    );
  }

  try {
    const data = await createLinkRecord({
      client,
      martCode: body.mart_code ?? "",
      adCreative: body.ad_creative ?? "",
    });
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof LinkServiceError) {
      if (error.code === "VALIDATION") {
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 400 },
        );
      }
      if (error.code === "AIRBRIDGE") {
        return NextResponse.json(
          { success: false, message: "Airbridge 링크 생성 실패", detail: error.message },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { success: false, message: "링크 저장 실패", detail: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { success: false, message: "링크 생성 실패", detail: error instanceof Error ? error.message : "unknown error" },
      { status: 500 },
    );
  }
}
