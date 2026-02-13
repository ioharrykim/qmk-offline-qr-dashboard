import { NextResponse } from "next/server";

import { createLinkRecord, LinkServiceError } from "@/lib/linkService";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type BulkCreateLinkBody = {
  mart_codes?: string[] | string;
  ad_creatives?: string[] | string;
  rows?: Array<{
    mart_code?: string;
    ad_creatives?: string[] | string;
  }>;
};

type BulkErrorRow = {
  mart_code: string;
  ad_creative: string;
  message: string;
};

function parseList(input: string[] | string | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
  }
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

async function createWithConcurrency(
  tasks: Array<{ martCode: string; adCreative: string }>,
  worker: (task: { martCode: string; adCreative: string }) => Promise<void>,
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

export async function POST(request: Request) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  let body: BulkCreateLinkBody;
  try {
    body = (await request.json()) as BulkCreateLinkBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "잘못된 요청 본문입니다." },
      { status: 400 },
    );
  }

  const tasks: Array<{ martCode: string; adCreative: string }> = [];

  if (Array.isArray(body.rows) && body.rows.length > 0) {
    for (const row of body.rows) {
      const martCode = row.mart_code?.trim() ?? "";
      if (!martCode) continue;

      const adCreatives = parseList(row.ad_creatives);
      for (const adCreative of adCreatives) {
        tasks.push({ martCode, adCreative });
      }
    }
  } else {
    const martCodes = parseList(body.mart_codes);
    const adCreatives = parseList(body.ad_creatives);
    for (const martCode of martCodes) {
      for (const adCreative of adCreatives) {
        tasks.push({ martCode, adCreative });
      }
    }
  }

  const dedupedTasks = Array.from(
    new Map(
      tasks
        .map((task) => ({
          martCode: task.martCode.trim(),
          adCreative: task.adCreative.trim(),
        }))
        .filter((task) => task.martCode && task.adCreative)
        .map((task) => [`${task.martCode}__${task.adCreative}`, task] as const),
    ).values(),
  );

  if (dedupedTasks.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message:
          "생성할 작업이 없습니다. mart_codes + ad_creatives 또는 rows[{ mart_code, ad_creatives }]를 확인해주세요.",
      },
      { status: 400 },
    );
  }

  if (dedupedTasks.length > 120) {
    return NextResponse.json(
      {
        success: false,
        message: `한 번에 최대 120건까지만 생성할 수 있습니다. 현재 요청: ${dedupedTasks.length}건`,
      },
      { status: 400 },
    );
  }

  const created: Array<{
    campaign_name: string;
    short_url: string;
    created_at: string;
    mart_code: string;
    ad_creative: string;
  }> = [];
  const errors: BulkErrorRow[] = [];

  await createWithConcurrency(
    dedupedTasks,
    async (task) => {
      try {
        const row = await createLinkRecord({
          client,
          martCode: task.martCode,
          adCreative: task.adCreative,
        });
        created.push(row);
      } catch (error) {
        if (error instanceof LinkServiceError) {
          errors.push({
            mart_code: task.martCode,
            ad_creative: task.adCreative,
            message: error.message,
          });
          return;
        }
        errors.push({
          mart_code: task.martCode,
          ad_creative: task.adCreative,
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    },
    4,
  );

  const summary = {
    requested: dedupedTasks.length,
    created: created.length,
    failed: errors.length,
  };

  if (created.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message: "대량 링크 생성에 실패했습니다.",
        summary,
        errors,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: errors.length === 0,
    summary,
    data: created,
    errors,
  });
}
