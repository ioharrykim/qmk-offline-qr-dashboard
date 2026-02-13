import { NextResponse } from "next/server";

import { createLinkRecord, LinkServiceError } from "@/lib/linkService";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type BulkCreateLinkBody = {
  mart_codes?: string[] | string;
  ad_creatives?: string[] | string;
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

  const martCodes = parseList(body.mart_codes);
  const adCreatives = parseList(body.ad_creatives);
  if (martCodes.length === 0 || adCreatives.length === 0) {
    return NextResponse.json(
      { success: false, message: "mart_codes와 ad_creatives는 최소 1개 이상 필요합니다." },
      { status: 400 },
    );
  }

  const tasks: Array<{ martCode: string; adCreative: string }> = [];
  for (const martCode of martCodes) {
    for (const adCreative of adCreatives) {
      tasks.push({ martCode, adCreative });
    }
  }

  if (tasks.length > 120) {
    return NextResponse.json(
      {
        success: false,
        message: `한 번에 최대 120건까지만 생성할 수 있습니다. 현재 요청: ${tasks.length}건`,
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
    tasks,
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
    requested: tasks.length,
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
