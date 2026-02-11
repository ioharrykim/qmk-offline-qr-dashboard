import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

import { toMartCode } from "@/lib/martCode";

export type MartSyncRecord = {
  mart_id: number;
  name: string;
  code: string;
  address: string | null;
  tel: string | null;
  enabled: boolean;
  manager_name: string | null;
  manager_tel: string | null;
};

export type LoadMartsFromGoogleSheetsResult = {
  records: MartSyncRecord[];
  totalRows: number;
  skippedRows: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("Request timed out") ||
    error.message.includes("ETIMEDOUT") ||
    error.message.includes("ECONNRESET")
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; baseDelayMs: number; context: string },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === options.retries;
      if (!isTimeoutError(error) || isLast) {
        throw error;
      }
      const delay = options.baseDelayMs * Math.pow(2, attempt);
      console.warn(`[googleSheets] timeout retry ${attempt + 1}/${options.retries} for ${options.context}`);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown error");
}

export function getMissingGoogleEnvKeys(): string[] {
  const requiredKeys = [
    "GOOGLE_SHEETS_SPREADSHEET_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
  ] as const;

  return requiredKeys.filter((key) => !process.env[key]);
}

function normalizePrivateKey(value: string): string {
  let normalized = value.trim();

  normalized = normalized
    .replace(/^\\?["']/, "")
    .replace(/\\?["']$/, "")
    .replace(/\\["']/g, "")
    .replace(/["']/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\\+n/g, "\n")
    .replace(/\\\n/g, "\n")
    .replace(/\\$/gm, "");

  return normalized;
}

function nullableText(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function parseMartId(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!raw || raw.toLowerCase() === "mart_id") {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

function parseEnabled(value: string | undefined): boolean | null {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw) {
    return false;
  }

  if (["true", "1", "yes", "y", "on"].includes(raw)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(raw)) {
    return false;
  }

  return null;
}

export async function loadMartsFromGoogleSheets(): Promise<LoadMartsFromGoogleSheetsResult> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!spreadsheetId || !serviceAccountEmail || !privateKeyRaw) {
    const missingEnvKeys = getMissingGoogleEnvKeys();
    throw new Error(`Missing required env: ${missingEnvKeys.join(", ")}`);
  }

  const privateKey = normalizePrivateKey(privateKeyRaw);

  const auth = new JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await withRetry(() => doc.loadInfo(), {
    retries: 2,
    baseDelayMs: 600,
    context: "doc.loadInfo",
  });

  const martsSheet = doc.sheetsByTitle["마트정보"];
  const managerContactsSheet = doc.sheetsByTitle["매니저연락처"];

  if (!martsSheet) {
    throw new Error('Sheet "마트정보" not found');
  }
  if (!managerContactsSheet) {
    throw new Error('Sheet "매니저연락처" not found');
  }

  const managerRows = await withRetry(
    () => managerContactsSheet.getRows<Record<string, string>>(),
    {
      retries: 2,
      baseDelayMs: 600,
      context: "매니저연락처.getRows",
    },
  );
  const managerPhoneByName = new Map<string, string>();

  for (const row of managerRows) {
    const managerName = row.get("매니저이름")?.toString().trim() ?? "";
    const phone = row.get("전화번호")?.toString().trim() ?? "";
    if (!managerName) {
      continue;
    }
    managerPhoneByName.set(managerName, phone || "");
  }

  const martRows = await withRetry(
    () => martsSheet.getRows<Record<string, string>>(),
    {
      retries: 2,
      baseDelayMs: 600,
      context: "마트정보.getRows",
    },
  );
  const records: MartSyncRecord[] = [];
  let skippedRows = 0;

  for (const row of martRows) {
    const martId = parseMartId(row.get("mart_id")?.toString());
    if (martId === null) {
      skippedRows += 1;
      continue;
    }

    const name = row.get("mart_name")?.toString().trim() ?? "";
    if (!name || name === "mart_name") {
      skippedRows += 1;
      continue;
    }

    const enabled = parseEnabled(row.get("enabled")?.toString());
    if (enabled === null) {
      skippedRows += 1;
      continue;
    }

    const managerName = nullableText(row.get("manager")?.toString());
    const managerTel = managerName
      ? nullableText(managerPhoneByName.get(managerName))
      : null;

    records.push({
      mart_id: martId,
      name,
      code: toMartCode(name),
      address: nullableText(row.get("mart_address")?.toString()),
      tel: nullableText(row.get("tel")?.toString()),
      enabled,
      manager_name: managerName,
      manager_tel: managerTel,
    });
  }

  return {
    records,
    totalRows: martRows.length,
    skippedRows,
  };
}
