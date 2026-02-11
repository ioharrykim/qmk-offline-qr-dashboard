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

    const { data: existingRows, error: existingRowsError } = await client
      .from("marts")
      .select("mart_id, code");

    if (existingRowsError) {
      return NextResponse.json(
        {
          success: false,
          message: "기존 marts 조회 실패",
          detail: existingRowsError.message,
        },
        { status: 500 },
      );
    }

    const reservedCodes = new Set<string>();
    const codeByMartId = new Map<number, string>();
    for (const row of existingRows ?? []) {
      if (row.code) {
        reservedCodes.add(row.code);
      }
      if (typeof row.mart_id === "number" && row.code) {
        codeByMartId.set(row.mart_id, row.code);
      }
    }

    const { records: normalizedRecords, adjustedCount: adjustedAgainstDb } =
      ensureCodesNotCollidingWithDb(uniqueBatchRecords, reservedCodes, codeByMartId);

    if (adjustedInBatch + adjustedAgainstDb + dropped > 0) {
      console.warn(
        `[marts/sync] normalized records (droppedByMartId=${dropped}, adjustedInBatch=${adjustedInBatch}, adjustedAgainstDb=${adjustedAgainstDb})`,
      );
    }

    if (normalizedRecords.length === 0) {
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

    const { data: byMartIdData, error: upsertError } = await client
      .from("marts")
      .upsert(normalizedRecords, { onConflict: "mart_id" })
      .select("mart_id");

    if (upsertError) {
      const schemaColumnMissing = upsertError.message.includes("Could not find the");

      return NextResponse.json(
        {
          success: false,
          message: schemaColumnMissing
            ? "마트 테이블 스키마가 최신이 아닙니다."
            : "마트 upsert 실패",
          detail: schemaColumnMissing
            ? "Supabase SQL Editor에서 supabase_marts_migration.sql 실행 후 다시 시도하세요."
            : `${upsertError.message} | hint: marts에 mart_id/code가 서로 다른 기존 row에 교차 점유되어 있으면 DB 정리 필요`,
        },
        { status: schemaColumnMissing ? 400 : 500 },
      );
    }

    upserted = byMartIdData?.length ?? normalizedRecords.length;

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
