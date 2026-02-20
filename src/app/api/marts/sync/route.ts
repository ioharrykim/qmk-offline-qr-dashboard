import { NextResponse } from "next/server";

import { getMissingGoogleEnvKeys, loadMartsFromGoogleSheets } from "@/lib/googleSheets";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type SyncRecord = {
  mart_id: number;
  code: string;
  name: string;
  address: string | null;
  tel: string | null;
  enabled: boolean;
  manager_name: string | null;
  manager_tel: string | null;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export const maxDuration = 60;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientFetchError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("network") ||
    lower.includes("socket")
  );
}

function isDuplicateCodeError(message: string) {
  return (
    message.includes("marts_code_key") ||
    message.includes("duplicate key value violates unique constraint")
  );
}

function isSchemaColumnMissing(message: string) {
  return message.includes("Could not find the");
}

async function runSupabaseWithRetry<T>(
  actionName: string,
  fn: () => PromiseLike<SupabaseResult<T>>,
  retries = 2,
): Promise<SupabaseResult<T>> {
  let lastResult: SupabaseResult<T> | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await fn();
    lastResult = result;

    if (!result.error) {
      return result;
    }

    if (!isTransientFetchError(result.error.message) || attempt === retries) {
      return result;
    }

    const delay = 350 * Math.pow(2, attempt);
    console.warn(
      `[marts/sync] transient error on ${actionName}, retry ${attempt + 1}/${retries} in ${delay}ms: ${result.error.message}`,
    );
    await sleep(delay);
  }

  return (
    lastResult ?? {
      data: null,
      error: { message: `${actionName} failed` },
    }
  );
}

function dedupeByMartId(records: SyncRecord[]) {
  const byMartId = new Map<number, SyncRecord>();
  let dropped = 0;

  for (const record of records) {
    if (byMartId.has(record.mart_id)) {
      dropped += 1;
    }
    byMartId.set(record.mart_id, record);
  }

  return { records: Array.from(byMartId.values()), dropped };
}

function ensureUniqueCodesInBatch<T extends { mart_id: number; code: string }>(records: T[]) {
  const usedCodes = new Set<string>();
  let adjustedCount = 0;

  const normalized = records.map((record) => {
    const baseCode = record.code?.trim() || `mart_${record.mart_id}`;
    let candidate = baseCode;

    if (usedCodes.has(candidate)) {
      adjustedCount += 1;
      candidate = `${baseCode}_${record.mart_id}`;
      let sequence = 1;
      while (usedCodes.has(candidate)) {
        sequence += 1;
        candidate = `${baseCode}_${record.mart_id}_${sequence}`;
      }
    }

    usedCodes.add(candidate);
    return candidate === record.code ? record : { ...record, code: candidate };
  });

  return { records: normalized, adjustedCount };
}

function ensureCodesNotCollidingWithDb(
  records: SyncRecord[],
  existingReservedCodes: Set<string>,
  currentCodeByMartId: Map<number, string>,
) {
  const usedCodes = new Set<string>();
  let adjustedCount = 0;

  const normalized = records.map((record) => {
    const baseCode = record.code?.trim() || `mart_${record.mart_id}`;
    const currentCode = currentCodeByMartId.get(record.mart_id) ?? null;
    let candidate = baseCode;
    let sequence = 0;

    const isConflict = (code: string) => {
      const conflictsBatch = usedCodes.has(code);
      const conflictsDb = existingReservedCodes.has(code) && code !== currentCode;
      return conflictsBatch || conflictsDb;
    };

    while (isConflict(candidate)) {
      adjustedCount += 1;
      sequence += 1;
      candidate =
        sequence === 1
          ? `${baseCode}_${record.mart_id}`
          : `${baseCode}_${record.mart_id}_${sequence}`;
    }

    usedCodes.add(candidate);
    return candidate === record.code ? record : { ...record, code: candidate };
  });

  return { records: normalized, adjustedCount };
}

export async function POST() {
  const missingGoogleEnvKeys = getMissingGoogleEnvKeys();
  if (missingGoogleEnvKeys.length > 0) {
    return NextResponse.json(
      {
        success: false,
        message: `Google env 누락: ${missingGoogleEnvKeys.join(", ")}`,
      },
      { status: 400 },
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

  try {
    const { records, totalRows, skippedRows } = await loadMartsFromGoogleSheets();
    const { records: dedupedByMartIdRecords, dropped } = dedupeByMartId(records);
    const { records: uniqueBatchRecords, adjustedCount: adjustedInBatch } =
      ensureUniqueCodesInBatch(dedupedByMartIdRecords);

    if (uniqueBatchRecords.length === 0) {
      return NextResponse.json({
        success: true,
        summary: {
          total: totalRows,
          upserted: 0,
          skipped: skippedRows,
        },
      });
    }

    let upserted = 0;
    let adjustedAgainstDb = 0;

    const firstUpsert = await runSupabaseWithRetry("marts upsert(first)", () =>
      client
        .from("marts")
        .upsert(uniqueBatchRecords, { onConflict: "mart_id" })
        .select("mart_id"),
    );

    let finalUpsert = firstUpsert;

    if (firstUpsert.error && isDuplicateCodeError(firstUpsert.error.message)) {
      const existingRowsResult = await runSupabaseWithRetry("marts select(existing)", () =>
        client.from("marts").select("mart_id, code"),
      );

      if (existingRowsResult.error) {
        const isNetwork = isTransientFetchError(existingRowsResult.error.message);
        return NextResponse.json(
          {
            success: false,
            message: "기존 marts 조회 실패",
            detail: isNetwork
              ? `${existingRowsResult.error.message} | 일시적 네트워크 오류 가능성이 높습니다. 잠시 후 다시 시도해 주세요.`
              : existingRowsResult.error.message,
          },
          { status: 500 },
        );
      }

      const reservedCodes = new Set<string>();
      const codeByMartId = new Map<number, string>();
      for (const row of existingRowsResult.data ?? []) {
        if (row.code) {
          reservedCodes.add(row.code);
        }
        if (typeof row.mart_id === "number" && row.code) {
          codeByMartId.set(row.mart_id, row.code);
        }
      }

      const normalizedWithDb = ensureCodesNotCollidingWithDb(
        uniqueBatchRecords,
        reservedCodes,
        codeByMartId,
      );
      adjustedAgainstDb = normalizedWithDb.adjustedCount;

      finalUpsert = await runSupabaseWithRetry("marts upsert(second)", () =>
        client
          .from("marts")
          .upsert(normalizedWithDb.records, { onConflict: "mart_id" })
          .select("mart_id"),
      );
    }

    if (finalUpsert.error) {
      const schemaColumnMissing = isSchemaColumnMissing(finalUpsert.error.message);
      const isNetwork = isTransientFetchError(finalUpsert.error.message);

      return NextResponse.json(
        {
          success: false,
          message: schemaColumnMissing
            ? "마트 테이블 스키마가 최신이 아닙니다."
            : "마트 upsert 실패",
          detail: schemaColumnMissing
            ? "Supabase SQL Editor에서 supabase_marts_migration.sql 실행 후 다시 시도하세요."
            : isNetwork
              ? `${finalUpsert.error.message} | 일시적 네트워크 오류 가능성이 높습니다. 잠시 후 다시 시도해 주세요.`
              : `${finalUpsert.error.message} | hint: marts에 mart_id/code가 서로 다른 기존 row에 교차 점유되어 있으면 DB 정리 필요`,
        },
        { status: schemaColumnMissing ? 400 : 500 },
      );
    }

    if (adjustedInBatch + adjustedAgainstDb + dropped > 0) {
      console.warn(
        `[marts/sync] normalized records (droppedByMartId=${dropped}, adjustedInBatch=${adjustedInBatch}, adjustedAgainstDb=${adjustedAgainstDb})`,
      );
    }

    upserted = finalUpsert.data?.length ?? uniqueBatchRecords.length;

    return NextResponse.json({
      success: true,
      summary: {
        total: totalRows,
        upserted,
        skipped: Math.max(totalRows - upserted, skippedRows),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    const detailWithHint = detail.includes("DECODER routines::unsupported")
      ? `${detail} | GOOGLE_PRIVATE_KEY format issue: set one-line PEM with escaped \\n (or JSON private_key 그대로 복사 후 \\n 유지).`
      : detail.includes("Request timed out")
        ? `${detail} | Google Sheets API timeout: 네트워크 상태 확인 후 재시도하거나 시트 크기/빈 행을 줄여주세요.`
        : detail;
    return NextResponse.json(
      {
        success: false,
        message: "Google Sheets 읽기 또는 동기화 실패",
        detail: detailWithHint,
      },
      { status: 500 },
    );
  }
}
