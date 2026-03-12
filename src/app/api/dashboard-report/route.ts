import { addDays, subDays } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

type AirbridgeTask = {
  status?: "PENDING" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELED";
  taskId?: string;
};

type DashboardMetricKey =
  | "clicks"
  | "impressions"
  | "app_installs"
  | "app_deeplink_opens"
  | "web_opens";

type DashboardMetricSummary = {
  current: number;
  previous: number;
  delta_percentage: number | null;
};

type DashboardMetricBucket = Record<DashboardMetricKey, number>;

type DashboardMartBreakdown = {
  mart_code: string | null;
  mart_name: string;
} & DashboardMetricBucket;

type DashboardResponseData = {
  channel_name: string;
  period_days: number;
  updated_at: string;
  date_range: {
    from: string;
    to: string;
  };
  previous_date_range: {
    from: string;
    to: string;
  };
  summary: Record<DashboardMetricKey, DashboardMetricSummary>;
  daily: Array<
    {
      date: string;
      top_marts: DashboardMartBreakdown[];
    } & DashboardMetricBucket
  >;
  creatives: Array<
    {
      ad_creative: string;
      top_marts: DashboardMartBreakdown[];
    } & DashboardMetricBucket
  >;
};

const PERIOD_OPTIONS = {
  "7d": 7,
  "30d": 30,
} as const;

const METRIC_KEYS: DashboardMetricKey[] = [
  "clicks",
  "impressions",
  "app_installs",
  "app_deeplink_opens",
  "web_opens",
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_POLL_ATTEMPTS = 8;
const DASHBOARD_POLL_INTERVAL_MS = 350;
const dashboardCache = new Map<
  string,
  { expiresAt: number; data: DashboardResponseData }
>();

export const maxDuration = 60;

function isTemplateValue(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.startsWith("__PUT_") ||
    normalized.includes("PUT_YOUR") ||
    normalized.includes("YOUR_")
  );
}

function getAirbridgeReportToken() {
  const apiToken = process.env.AIRBRIDGE_API_TOKEN?.trim();
  const trackingToken = process.env.AIRBRIDGE_TRACKING_LINK_API_TOKEN?.trim();

  if (!isTemplateValue(apiToken)) return apiToken;
  if (!isTemplateValue(trackingToken)) return trackingToken;
  return null;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function buildZeroMetricBucket(): DashboardMetricBucket {
  return {
    clicks: 0,
    impressions: 0,
    app_installs: 0,
    app_deeplink_opens: 0,
    web_opens: 0,
  };
}

function buildTopMartBreakdown(
  martMap: Map<string, DashboardMetricBucket>,
  martNameMap: Map<string, string>,
): DashboardMartBreakdown[] {
  return Array.from(martMap.entries())
    .map(([martCode, metrics]) => ({
      mart_code: martCode === "__unknown__" ? null : martCode,
      mart_name:
        martCode === "__unknown__"
          ? "미확인 마트"
          : martNameMap.get(martCode) ?? martCode,
      ...metrics,
    }))
    .sort((a, b) => {
      if (b.clicks !== a.clicks) return b.clicks - a.clicks;
      if (b.app_installs !== a.app_installs) return b.app_installs - a.app_installs;
      return b.web_opens - a.web_opens;
    })
    .slice(0, 5);
}

function buildDateRange(from: Date, to: Date, timeZone: string) {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    dates.push(formatDateInTimeZone(cursor, timeZone));
  }
  return dates;
}

function normalizeEventDate(value: unknown) {
  if (typeof value !== "string") return null;
  const matched = value.match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readMetricValue(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const value = toRecord(raw)?.value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function calculateDeltaPercentage(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAirbridgeJson(input: string, init: RequestInit, token: string) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Accept-Language": "ko",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function getCachedDashboard(cacheKey: string) {
  const cached = dashboardCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function setCachedDashboard(cacheKey: string, data: DashboardResponseData) {
  dashboardCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function GET(request: NextRequest) {
  const periodParam = request.nextUrl.searchParams.get("period") ?? "30d";
  const periodDays =
    PERIOD_OPTIONS[periodParam as keyof typeof PERIOD_OPTIONS] ?? PERIOD_OPTIONS["30d"];

  const appName = process.env.AIRBRIDGE_APP_NAME?.trim();
  const token = getAirbridgeReportToken();
  const channelName = process.env.AIRBRIDGE_CHANNEL_NAME?.trim() || "offline-qr";
  const timeZone = process.env.AIRBRIDGE_TIMEZONE?.trim() || "Asia/Seoul";

  if (isTemplateValue(appName) || !token) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge env가 설정되지 않았습니다.",
        detail: "AIRBRIDGE_APP_NAME, AIRBRIDGE_API_TOKEN 확인",
      },
      { status: 400 },
    );
  }

  const cacheKey = `${appName}:${channelName}:${periodDays}`;
  const cached = getCachedDashboard(cacheKey);
  if (cached) {
    return NextResponse.json({
      success: true,
      cached: true,
      data: cached,
    });
  }

  const today = new Date();
  const currentTo = today;
  const currentFrom = subDays(today, periodDays - 1);
  const previousTo = subDays(currentFrom, 1);
  const previousFrom = subDays(previousTo, periodDays - 1);

  const currentDates = buildDateRange(currentFrom, currentTo, timeZone);
  const previousDates = buildDateRange(previousFrom, previousTo, timeZone);
  const queryFrom = formatDateInTimeZone(previousFrom, timeZone);
  const queryTo = formatDateInTimeZone(currentTo, timeZone);

  const { response: startResponse, payload: startPayload } = await fetchAirbridgeJson(
    `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query`,
    {
      method: "POST",
      body: JSON.stringify({
        from: queryFrom,
        to: queryTo,
        metrics: METRIC_KEYS,
        groupBys: ["event_date", "ad_creative", "ad_group"],
        sorts: [
          {
            fieldName: "event_date",
            isAscending: true,
          },
        ],
        filters: [
          {
            dimension: "channel",
            filterType: "IN",
            values: [channelName],
          },
        ],
      }),
    },
    token,
  );

  const startTask = (toRecord(startPayload)?.task || {}) as AirbridgeTask;
  if (!startResponse.ok || !startTask.taskId) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge 대시보드 리포트 시작 실패",
        detail:
          toRecord(startPayload)?.detail?.toString() ||
          toRecord(startPayload)?.title?.toString() ||
          "unknown error",
      },
      { status: 502 },
    );
  }

  let finalPayload: unknown = null;
  let finalStatus: AirbridgeTask["status"] = startTask.status;

  for (let attempt = 0; attempt < DASHBOARD_POLL_ATTEMPTS; attempt += 1) {
    const polled = await fetchAirbridgeJson(
      `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query/${startTask.taskId}`,
      { method: "GET" },
      token,
    );

    finalPayload = polled.payload;
    finalStatus = (toRecord(polled.payload)?.task as AirbridgeTask | undefined)?.status;

    if (
      finalStatus === "SUCCESS" ||
      finalStatus === "FAILURE" ||
      finalStatus === "CANCELED"
    ) {
      break;
    }

    await sleep(DASHBOARD_POLL_INTERVAL_MS);
  }

  if (finalStatus !== "SUCCESS") {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge 대시보드 리포트 집계가 아직 완료되지 않았습니다.",
        detail:
          toRecord(finalPayload)?.detail?.toString() ||
          `status=${finalStatus ?? "UNKNOWN"}`,
      },
      { status: 504 },
    );
  }

  const rows = toRecord(toRecord(toRecord(finalPayload)?.actuals)?.data)?.rows;
  const currentDateSet = new Set(currentDates);
  const previousDateSet = new Set(previousDates);
  const currentTotals = buildZeroMetricBucket();
  const previousTotals = buildZeroMetricBucket();
  const dailyMap = new Map<string, DashboardMetricBucket>();
  const dailyMartMap = new Map<string, Map<string, DashboardMetricBucket>>();
  const creativeMap = new Map<string, DashboardMetricBucket>();
  const creativeMartMap = new Map<string, Map<string, DashboardMetricBucket>>();

  const { client } = getSupabaseServerClient();
  const martNameMap = new Map<string, string>();
  if (client) {
    const martsResult = await client.from("marts").select("name, code");
    if (!martsResult.error) {
      for (const mart of martsResult.data ?? []) {
        if (mart?.code && mart?.name) {
          martNameMap.set(String(mart.code), String(mart.name));
        }
      }
    }
  }

  for (const date of currentDates) {
    dailyMap.set(date, buildZeroMetricBucket());
    dailyMartMap.set(date, new Map());
  }

  if (Array.isArray(rows)) {
    for (const rawRow of rows) {
      const row = toRecord(rawRow);
      const groupBys = Array.isArray(row?.groupBys) ? row.groupBys : [];
      const eventDate = normalizeEventDate(groupBys[0]);
      const adCreative =
        typeof groupBys[1] === "string" && groupBys[1].trim()
          ? groupBys[1].trim()
          : "unknown";
      const martCode =
        typeof groupBys[2] === "string" && groupBys[2].trim()
          ? groupBys[2].trim()
          : "__unknown__";
      const values = toRecord(row?.values);

      if (!eventDate || !values) continue;

      const metrics: DashboardMetricBucket = {
        clicks: readMetricValue(values.clicks),
        impressions: readMetricValue(values.impressions),
        app_installs: readMetricValue(values.app_installs),
        app_deeplink_opens: readMetricValue(values.app_deeplink_opens),
        web_opens: readMetricValue(values.web_opens),
      };

      if (currentDateSet.has(eventDate)) {
        const currentBucket = dailyMap.get(eventDate) ?? buildZeroMetricBucket();
        const currentDayMartMap =
          dailyMartMap.get(eventDate) ?? new Map<string, DashboardMetricBucket>();
        const creativeBucket = creativeMap.get(adCreative) ?? buildZeroMetricBucket();
        const currentCreativeMartMap =
          creativeMartMap.get(adCreative) ?? new Map<string, DashboardMetricBucket>();
        const dayMartBucket = currentDayMartMap.get(martCode) ?? buildZeroMetricBucket();
        const creativeMartBucket =
          currentCreativeMartMap.get(martCode) ?? buildZeroMetricBucket();

        for (const metricKey of METRIC_KEYS) {
          currentTotals[metricKey] += metrics[metricKey];
          currentBucket[metricKey] += metrics[metricKey];
          creativeBucket[metricKey] += metrics[metricKey];
          dayMartBucket[metricKey] += metrics[metricKey];
          creativeMartBucket[metricKey] += metrics[metricKey];
        }

        dailyMap.set(eventDate, currentBucket);
        currentDayMartMap.set(martCode, dayMartBucket);
        dailyMartMap.set(eventDate, currentDayMartMap);
        creativeMap.set(adCreative, creativeBucket);
        currentCreativeMartMap.set(martCode, creativeMartBucket);
        creativeMartMap.set(adCreative, currentCreativeMartMap);
      } else if (previousDateSet.has(eventDate)) {
        for (const metricKey of METRIC_KEYS) {
          previousTotals[metricKey] += metrics[metricKey];
        }
      }
    }
  }

  const data: DashboardResponseData = {
    channel_name: channelName,
    period_days: periodDays,
    updated_at: new Date().toISOString(),
    date_range: {
      from: formatDateInTimeZone(currentFrom, timeZone),
      to: formatDateInTimeZone(currentTo, timeZone),
    },
    previous_date_range: {
      from: formatDateInTimeZone(previousFrom, timeZone),
      to: formatDateInTimeZone(previousTo, timeZone),
    },
    summary: {
      clicks: {
        current: currentTotals.clicks,
        previous: previousTotals.clicks,
        delta_percentage: calculateDeltaPercentage(
          currentTotals.clicks,
          previousTotals.clicks,
        ),
      },
      impressions: {
        current: currentTotals.impressions,
        previous: previousTotals.impressions,
        delta_percentage: calculateDeltaPercentage(
          currentTotals.impressions,
          previousTotals.impressions,
        ),
      },
      app_installs: {
        current: currentTotals.app_installs,
        previous: previousTotals.app_installs,
        delta_percentage: calculateDeltaPercentage(
          currentTotals.app_installs,
          previousTotals.app_installs,
        ),
      },
      app_deeplink_opens: {
        current: currentTotals.app_deeplink_opens,
        previous: previousTotals.app_deeplink_opens,
        delta_percentage: calculateDeltaPercentage(
          currentTotals.app_deeplink_opens,
          previousTotals.app_deeplink_opens,
        ),
      },
      web_opens: {
        current: currentTotals.web_opens,
        previous: previousTotals.web_opens,
        delta_percentage: calculateDeltaPercentage(
          currentTotals.web_opens,
          previousTotals.web_opens,
        ),
      },
    },
    daily: currentDates.map((date) => ({
      date,
      top_marts: buildTopMartBreakdown(
        dailyMartMap.get(date) ?? new Map<string, DashboardMetricBucket>(),
        martNameMap,
      ),
      ...(dailyMap.get(date) ?? buildZeroMetricBucket()),
    })),
    creatives: Array.from(creativeMap.entries())
      .map(([ad_creative, metrics]) => ({
        ad_creative,
        top_marts: buildTopMartBreakdown(
          creativeMartMap.get(ad_creative) ?? new Map<string, DashboardMetricBucket>(),
          martNameMap,
        ),
        ...metrics,
      }))
      .sort((a, b) => b.clicks - a.clicks),
  };

  setCachedDashboard(cacheKey, data);

  return NextResponse.json({
    success: true,
    data,
  });
}
