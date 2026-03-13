import { NextResponse } from "next/server";

import { createLinkRecord, LinkServiceError } from "@/lib/linkService";
import {
  resolveOrderAutomationTasks,
  type OrderAutomationRowInput,
} from "@/lib/orderAutomation";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const maxDuration = 60;

type IntakeBody = {
  source?: string;
  source_sheet?: string;
  rows?: OrderAutomationRowInput[];
  meta?: Record<string, unknown>;
};

function readSecret(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return request.headers.get("x-order-automation-secret")?.trim() ?? "";
}

async function createWithConcurrency<T>(
  tasks: T[],
  worker: (task: T) => Promise<void>,
  concurrency: number,
) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, tasks.length)) },
    async () => {
      while (cursor < tasks.length) {
        const current = tasks[cursor];
        cursor += 1;
        await worker(current);
      }
    },
  );
  await Promise.all(workers);
}

async function insertBatchItemWithFallback(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>["client"]>,
  payload: Record<string, unknown>,
) {
  const insertResult = await client.from("order_qr_batch_items").insert(payload);
  if (
    insertResult.error &&
    payload.handler &&
    insertResult.error.message.toLowerCase().includes("handler")
  ) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.handler;
    return client.from("order_qr_batch_items").insert(fallbackPayload);
  }
  return insertResult;
}

export async function POST(request: Request) {
  const expectedSecret = process.env.ORDER_AUTOMATION_SECRET?.trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { success: false, message: "ORDER_AUTOMATION_SECRET env가 설정되지 않았습니다." },
      { status: 503 },
    );
  }

  const providedSecret = readSecret(request);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, message: "order automation secret이 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  let body: IntakeBody;
  try {
    body = (await request.json()) as IntakeBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "잘못된 요청 본문입니다." },
      { status: 400 },
    );
  }

  const inputRows = Array.isArray(body.rows) ? body.rows : [];
  if (inputRows.length === 0) {
    return NextResponse.json(
      { success: false, message: "rows 배열이 비어 있습니다." },
      { status: 400 },
    );
  }

  const martsQuery = await client.from("marts").select("name, code").order("name", { ascending: true });
  if (martsQuery.error) {
    return NextResponse.json(
      { success: false, message: "마트 조회 실패", detail: martsQuery.error.message },
      { status: 500 },
    );
  }

  const resolvedTasks = resolveOrderAutomationTasks({
    rows: inputRows,
    marts: martsQuery.data ?? [],
  });

  const batchInsert = await client
    .from("order_qr_batches")
    .insert({
      source: body.source?.trim() || "apps-script",
      source_sheet: body.source_sheet?.trim() || null,
      status: "RUNNING",
      requested_count: resolvedTasks.resolved.length + resolvedTasks.unresolved.length,
      created_count: 0,
      failed_count: 0,
      payload: {
        meta: body.meta ?? {},
        raw_count: inputRows.length,
      },
    })
    .select("id")
    .single();

  if (batchInsert.error || !batchInsert.data) {
    return NextResponse.json(
      {
        success: false,
        message: "발주 QR 배치 생성 실패",
        detail: batchInsert.error?.message ?? "batch insert failed",
      },
      { status: 500 },
    );
  }

  const batchId = batchInsert.data.id;
  const createdItems: Array<{ mart_code: string; ad_creative: string; campaign_name: string; short_url: string }> = [];
  let failedCount = 0;

  for (const unresolved of resolvedTasks.unresolved) {
    failedCount += 1;
    await insertBatchItemWithFallback(client, {
      batch_id: batchId,
      mart_name: unresolved.mart_name,
      mart_code: unresolved.mart_code,
      item_type: unresolved.item_type,
      ad_creative: unresolved.ad_creative,
      quantity: unresolved.quantity,
      handler: unresolved.handler,
      requester: unresolved.requester,
      filename: unresolved.filename,
      design_type: unresolved.design_type,
      spec: unresolved.spec,
      status: "FAILED",
      error_message: unresolved.error_message,
    });
  }

  await createWithConcurrency(
    resolvedTasks.resolved,
    async (task) => {
      try {
        const created = await createLinkRecord({
          client,
          martCode: task.mart_code,
          adCreative: task.ad_creative,
        });

        createdItems.push({
          mart_code: created.mart_code,
          ad_creative: created.ad_creative,
          campaign_name: created.campaign_name,
          short_url: created.short_url,
        });

        const itemInsert = await insertBatchItemWithFallback(client, {
          batch_id: batchId,
          mart_name: task.mart_name,
          mart_code: task.mart_code,
          item_type: task.item_type,
          ad_creative: task.ad_creative,
          quantity: task.quantity,
          handler: task.handler,
          requester: task.requester,
          filename: task.filename,
          design_type: task.design_type,
          spec: task.spec,
          campaign_name: created.campaign_name,
          short_url: created.short_url,
          status: "SUCCESS",
        });

        if (itemInsert.error) {
          throw new LinkServiceError("DB", itemInsert.error.message);
        }
      } catch (error) {
        failedCount += 1;
        await insertBatchItemWithFallback(client, {
          batch_id: batchId,
          mart_name: task.mart_name,
          mart_code: task.mart_code,
          item_type: task.item_type,
          ad_creative: task.ad_creative,
          quantity: task.quantity,
          handler: task.handler,
          requester: task.requester,
          filename: task.filename,
          design_type: task.design_type,
          spec: task.spec,
          status: "FAILED",
          error_message: error instanceof Error ? error.message : "unknown error",
        });
      }
    },
    4,
  );

  const createdCount = createdItems.length;
  const batchStatus = createdCount === 0 ? "FAILED" : failedCount > 0 ? "PARTIAL" : "SUCCESS";

  await client
    .from("order_qr_batches")
    .update({
      status: batchStatus,
      created_count: createdCount,
      failed_count: failedCount,
    })
    .eq("id", batchId);

  return NextResponse.json({
    success: createdCount > 0,
    data: {
      batch_id: batchId,
      status: batchStatus,
      requested_count: resolvedTasks.resolved.length + resolvedTasks.unresolved.length,
      created_count: createdCount,
      failed_count: failedCount,
      items: createdItems,
    },
  });
}
