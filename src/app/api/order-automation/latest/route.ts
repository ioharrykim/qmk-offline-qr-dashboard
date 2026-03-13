import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const MAX_BATCH_AGE_DAYS = 14;
const RECENT_BATCH_LIMIT = 3;
export const dynamic = "force-dynamic";

type BatchRow = {
  id: number;
  source: string;
  source_sheet: string | null;
  status: string;
  requested_count: number;
  created_count: number;
  failed_count: number;
  created_at: string;
};

type ItemRow = {
  id: number;
  batch_id: number;
  mart_name: string;
  mart_code: string | null;
  item_type: string;
  ad_creative: string | null;
  quantity: number;
  handler: string | null;
  requester: string | null;
  filename: string | null;
  design_type: string | null;
  spec: string | null;
  campaign_name: string | null;
  short_url: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

function summarizeNames(values: string[]) {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  return `${unique[0]} 외 ${unique.length - 1}건`;
}

async function fetchBatchItems(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>["client"]>,
  batchIds: number[],
) {
  const withHandler = await client
    .from("order_qr_batch_items")
    .select(
      "id, batch_id, mart_name, mart_code, item_type, ad_creative, quantity, handler, requester, filename, design_type, spec, campaign_name, short_url, status, error_message, created_at",
    )
    .in("batch_id", batchIds)
    .order("created_at", { ascending: true });

  if (!withHandler.error) return withHandler;

  if (!withHandler.error.message.toLowerCase().includes("handler")) {
    return withHandler;
  }

  const fallback = await client
    .from("order_qr_batch_items")
    .select(
      "id, batch_id, mart_name, mart_code, item_type, ad_creative, quantity, requester, filename, design_type, spec, campaign_name, short_url, status, error_message, created_at",
    )
    .in("batch_id", batchIds)
    .order("created_at", { ascending: true });

  if (!fallback.error) {
    const normalized = (fallback.data ?? []).map((item) => ({
      ...item,
      handler: null,
    }));
    return { ...fallback, data: normalized };
  }

  return fallback;
}

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
    .limit(RECENT_BATCH_LIMIT);

  if (batchResult.error) {
    if (
      batchResult.error.message.includes("order_qr_batches") ||
      batchResult.error.message.includes("schema cache")
    ) {
      return NextResponse.json({ success: true, data: { latest_batch_id: null, batches: [] } });
    }
    return NextResponse.json(
      { success: false, message: "최근 발주 QR 배치 조회 실패", detail: batchResult.error.message },
      { status: 500 },
    );
  }

  const batches = (batchResult.data ?? []) as BatchRow[];
  if (batches.length === 0) {
    return NextResponse.json({ success: true, data: { latest_batch_id: null, batches: [] } });
  }

  const batchIds = batches.map((batch) => batch.id);
  const itemsResult = await fetchBatchItems(client, batchIds);

  if (itemsResult.error) {
    return NextResponse.json(
      { success: false, message: "최근 발주 QR 배치 아이템 조회 실패", detail: itemsResult.error.message },
      { status: 500 },
    );
  }

  const itemsByBatchId = new Map<number, ItemRow[]>();
  for (const rawItem of (itemsResult.data ?? []) as ItemRow[]) {
    const existing = itemsByBatchId.get(rawItem.batch_id) ?? [];
    existing.push(rawItem);
    itemsByBatchId.set(rawItem.batch_id, existing);
  }

  const responseBatches = batches.map((batch) => {
    const items = itemsByBatchId.get(batch.id) ?? [];
    const successfulItems = items.filter(
      (item) => item.status === "SUCCESS" && item.short_url && item.campaign_name,
    );

    return {
      batch,
      mart_summary: summarizeNames(successfulItems.map((item) => item.mart_name)),
      handler_summary: summarizeNames(successfulItems.map((item) => item.handler ?? "")),
      requester_summary: summarizeNames(successfulItems.map((item) => item.requester ?? "")),
      items,
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      latest_batch_id: batches[0]?.id ?? null,
      batches: responseBatches,
    },
  });
}
