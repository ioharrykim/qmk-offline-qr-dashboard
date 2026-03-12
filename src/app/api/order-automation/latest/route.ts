import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const MAX_BATCH_AGE_DAYS = 14;
export const dynamic = "force-dynamic";

export async function GET() {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  const cutoff = new Date(Date.now() - MAX_BATCH_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const batchResult = await client
    .from("order_qr_batches")
    .select("id, source, source_sheet, status, requested_count, created_count, failed_count, created_at")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (batchResult.error) {
    if (
      batchResult.error.message.includes("order_qr_batches") ||
      batchResult.error.message.includes("schema cache")
    ) {
      return NextResponse.json({ success: true, data: null });
    }
    return NextResponse.json(
      { success: false, message: "최근 발주 QR 배치 조회 실패", detail: batchResult.error.message },
      { status: 500 },
    );
  }

  if (!batchResult.data) {
    return NextResponse.json({ success: true, data: null });
  }

  const itemsResult = await client
    .from("order_qr_batch_items")
    .select(
      "id, mart_name, mart_code, item_type, ad_creative, quantity, requester, filename, design_type, spec, campaign_name, short_url, status, error_message, created_at",
    )
    .eq("batch_id", batchResult.data.id)
    .order("created_at", { ascending: true });

  if (itemsResult.error) {
    return NextResponse.json(
      { success: false, message: "최근 발주 QR 배치 아이템 조회 실패", detail: itemsResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      batch: batchResult.data,
      items: itemsResult.data ?? [],
    },
  });
}
