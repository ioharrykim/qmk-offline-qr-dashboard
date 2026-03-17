import { addDays, subDays } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import {
  getFlyerImageCampaigns,
  type FlyerImageCampaignMeta,
} from "@/lib/flyerImageCampaigns";
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

type FlyerImageCampaignPerformance = FlyerImageCampaignMeta & {
  top_marts: DashboardMartBreakdown[];
} & DashboardMetricBucket;

type FlyerImagesReportData = {
  updated_at: string;
  period_days: number;
  comparison_available: boolean;
  date_range: {
    from: string;
    to: string;
  };
  previous_date_range: {
    from: string;
    to: string;
  };
  campaigns: FlyerImageCampaignPerformance[];
  summary: Record<DashboardMetricKey, DashboardMetricSummary>;
  overall_top_marts: DashboardMartBreakdown[];
  daily: Array<
    {
      date: string;
      top_marts: DashboardMartBreakdown[];
    } & DashboardMetricBucket
  >;
};

const PERIOD_OPTIONS = {
  "30d": 30,
  "90d": 90,
  "400d": 400,
} as const;

const METRIC_KEYS: DashboardMetricKey[] = [
  "clicks",
  "impressions",
  "app_installs",
  "app_deeplink_opens",
  "web_opens",
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const REPORT_POLL_ATTEMPTS = 10;
const REPORT_POLL_INTERVAL_MS = 400;
const reportCache = new Map<
  string,
  { expiresAt: number; data: FlyerImagesReportData }
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

function buildDateRange(from: Date, to: Date, timeZone: string) {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    dates.push(formatDateInTimeZone(cursor, timeZone));
  }
  return dates;
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeEventDate(value: unknown) {
  if (typeof value !== "string") return null;
  const matched = value.match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : null;
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

function getCachedReport(cacheKey: string) {
  const cached = reportCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    reportCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function setCachedReport(cacheKey: string, data: FlyerImagesReportData) {
  reportCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchMartNameMap() {
  const { client } = getSupabaseServerClient();
  const martNameMap = new Map<string, string>();

  if (!client) return martNameMap;

  const martsResult = await client.from("marts").select("name, code");
  if (martsResult.error) return martNameMap;

  for (const mart of martsResult.data ?? []) {
    if (mart?.code && mart?.name) {
      martNameMap.set(String(mart.code), String(mart.name));
    }
  }

  return martNameMap;
}

async function runAirbridgeReportQuery(params: {
  appName: string;
  token: string;
  from: string;
  to: string;
  campaigns: string[];
  groupBys: string[];
  sortFieldName: string;
}) {
  const { response: startResponse, payload: startPayload } = await fetchAirbridgeJson(
    `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(params.appName)}/actuals/query`,
    {
      method: "POST",
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        metrics: METRIC_KEYS,
        groupBys: params.groupBys,
        sorts: [
          {
            fieldName: params.sortFieldName,
            isAscending: true,
          },
        ],
        filters: [
          {
            dimension: "campaign",
            filterType: "IN",
            values: params.campaigns,
          },
        ],
      }),
    },
    params.token,
  );

  const startTask = (toRecord(startPayload)?.task || {}) as AirbridgeTask;
  if (!startResponse.ok || !startTask.taskId) {
    throw new Error(
      toRecord(startPayload)?.detail?.toString() ||
        toRecord(startPayload)?.title?.toString() ||
        "Airbridge 리포트 시작 실패",
    );
  }

  let finalPayload: unknown = null;
  let finalStatus: AirbridgeTask["status"] = startTask.status;

  for (let attempt = 0; attempt < REPORT_POLL_ATTEMPTS; attempt += 1) {
    const polled = await fetchAirbridgeJson(
      `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(params.appName)}/actuals/query/${startTask.taskId}`,
      { method: "GET" },
      params.token,
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

    await sleep(REPORT_POLL_INTERVAL_MS);
  }

  if (finalStatus !== "SUCCESS") {
    throw new Error(
      toRecord(finalPayload)?.detail?.toString() || `status=${finalStatus ?? "UNKNOWN"}`,
    );
  }

  const rows = toRecord(toRecord(toRecord(finalPayload)?.actuals)?.data)?.rows;
  return Array.isArray(rows) ? rows : [];
}

function metricBucketFromValues(values: Record<string, unknown>): DashboardMetricBucket {
  return {
    clicks: readMetricValue(values.clicks),
    impressions: readMetricValue(values.impressions),
    app_installs: readMetricValue(values.app_installs),
    app_deeplink_opens: readMetricValue(values.app_deeplink_opens),
    web_opens: readMetricValue(values.web_opens),
  };
}

function aggregateSummaryByCampaign(params: {
  rows: unknown[];
  campaignList: FlyerImageCampaignMeta[];
}) {
  const totals = buildZeroMetricBucket();
  const campaignMetricMap = new Map<string, DashboardMetricBucket>();

  for (const rawRow of params.rows) {
    const row = toRecord(rawRow);
    const groupBys = Array.isArray(row?.groupBys) ? row.groupBys : [];
    const campaign =
      typeof groupBys[0] === "string" && groupBys[0].trim() ? groupBys[0].trim() : null;
    const values = toRecord(row?.values);

    if (!campaign || !values) continue;
    const campaignBucket = campaignMetricMap.get(campaign) ?? buildZeroMetricBucket();
    const metrics = metricBucketFromValues(values);

    for (const metricKey of METRIC_KEYS) {
      totals[metricKey] += metrics[metricKey];
      campaignBucket[metricKey] += metrics[metricKey];
    }

    campaignMetricMap.set(campaign, campaignBucket);
  }

  return {
    totals,
    campaigns: params.campaignList
      .map((meta) => ({
        ...meta,
        top_marts: [] as DashboardMartBreakdown[],
        ...(campaignMetricMap.get(meta.campaign) ?? buildZeroMetricBucket()),
      }))
      .sort((a, b) => b.clicks - a.clicks),
  };
}

function aggregateDailyByDate(params: {
  rows: unknown[];
  dates: string[];
}) {
  const dateSet = new Set(params.dates);
  const dailyMap = new Map<string, DashboardMetricBucket>();

  for (const date of params.dates) {
    dailyMap.set(date, buildZeroMetricBucket());
  }

  for (const rawRow of params.rows) {
    const row = toRecord(rawRow);
    const groupBys = Array.isArray(row?.groupBys) ? row.groupBys : [];
    const eventDate = normalizeEventDate(groupBys[0]);
    const values = toRecord(row?.values);

    if (!eventDate || !values || !dateSet.has(eventDate)) continue;
    const bucket = dailyMap.get(eventDate) ?? buildZeroMetricBucket();
    const metrics = metricBucketFromValues(values);

    for (const metricKey of METRIC_KEYS) {
      bucket[metricKey] += metrics[metricKey];
    }

    dailyMap.set(eventDate, bucket);
  }

  return params.dates.map((date) => ({
    date,
    top_marts: [] as DashboardMartBreakdown[],
    ...(dailyMap.get(date) ?? buildZeroMetricBucket()),
  }));
}

function aggregateMartBreakdowns(params: {
  rows: unknown[];
  martNameMap: Map<string, string>;
  campaignList: FlyerImageCampaignMeta[];
}) {
  const campaignMartMap = new Map<string, Map<string, DashboardMetricBucket>>();
  const overallMartMap = new Map<string, DashboardMetricBucket>();

  for (const rawRow of params.rows) {
    const row = toRecord(rawRow);
    const groupBys = Array.isArray(row?.groupBys) ? row.groupBys : [];
    const campaign =
      typeof groupBys[0] === "string" && groupBys[0].trim() ? groupBys[0].trim() : null;
    const martCode =
      typeof groupBys[1] === "string" && groupBys[1].trim()
        ? groupBys[1].trim()
        : "__unknown__";
    const values = toRecord(row?.values);

    if (!campaign || !values) continue;

    const campaignMartBuckets =
      campaignMartMap.get(campaign) ?? new Map<string, DashboardMetricBucket>();
    const campaignMartBucket = campaignMartBuckets.get(martCode) ?? buildZeroMetricBucket();
    const overallMartBucket = overallMartMap.get(martCode) ?? buildZeroMetricBucket();
    const metrics = metricBucketFromValues(values);

    for (const metricKey of METRIC_KEYS) {
      campaignMartBucket[metricKey] += metrics[metricKey];
      overallMartBucket[metricKey] += metrics[metricKey];
    }

    campaignMartBuckets.set(martCode, campaignMartBucket);
    campaignMartMap.set(campaign, campaignMartBuckets);
    overallMartMap.set(martCode, overallMartBucket);
  }

  return {
    overall_top_marts: buildTopMartBreakdown(overallMartMap, params.martNameMap),
    campaignTopMartMap: new Map(
      params.campaignList.map((meta) => [
        meta.campaign,
        buildTopMartBreakdown(
          campaignMartMap.get(meta.campaign) ?? new Map<string, DashboardMetricBucket>(),
          params.martNameMap,
        ),
      ]),
    ),
  };
}

export async function GET(request: NextRequest) {
  const periodParam = request.nextUrl.searchParams.get("period") ?? "400d";
  const periodDays =
    PERIOD_OPTIONS[periodParam as keyof typeof PERIOD_OPTIONS] ?? PERIOD_OPTIONS["400d"];

  const appName = process.env.AIRBRIDGE_APP_NAME?.trim();
  const token = getAirbridgeReportToken();
  const timeZone = process.env.AIRBRIDGE_TIMEZONE?.trim() || "Asia/Seoul";
  const campaignList = getFlyerImageCampaigns();
  const campaignNames = campaignList.map((item) => item.campaign);

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

  const cacheKey = `${appName}:flyer-images:${periodDays}:${campaignNames.join(",")}`;
  const cached = getCachedReport(cacheKey);
  if (cached) {
    return NextResponse.json({ success: true, cached: true, data: cached });
  }

  const today = new Date();
  const currentTo = today;
  const currentFrom = subDays(today, periodDays - 1);
  const previousTo = subDays(currentFrom, 1);
  const previousFrom = subDays(previousTo, periodDays - 1);
  const currentDates = buildDateRange(currentFrom, currentTo, timeZone);
  const martNameMap = await fetchMartNameMap();

  let currentSummaryRows: unknown[] = [];
  let currentDailyRows: unknown[] = [];
  let currentMartRows: unknown[] = [];
  let previousSummaryRows: unknown[] = [];
  let previousError: string | null = null;

  try {
    [currentSummaryRows, currentDailyRows, currentMartRows, previousSummaryRows] =
      await Promise.all([
      runAirbridgeReportQuery({
        appName: appName as string,
        token,
        from: formatDateInTimeZone(currentFrom, timeZone),
        to: formatDateInTimeZone(currentTo, timeZone),
        campaigns: campaignNames,
        groupBys: ["campaign"],
        sortFieldName: "campaign",
      }),
      runAirbridgeReportQuery({
        appName: appName as string,
        token,
        from: formatDateInTimeZone(currentFrom, timeZone),
        to: formatDateInTimeZone(currentTo, timeZone),
        campaigns: campaignNames,
        groupBys: ["event_date"],
        sortFieldName: "event_date",
      }),
      runAirbridgeReportQuery({
        appName: appName as string,
        token,
        from: formatDateInTimeZone(currentFrom, timeZone),
        to: formatDateInTimeZone(currentTo, timeZone),
        campaigns: campaignNames,
        groupBys: ["campaign", "ad_group"],
        sortFieldName: "campaign",
      }),
      runAirbridgeReportQuery({
        appName: appName as string,
        token,
        from: formatDateInTimeZone(previousFrom, timeZone),
        to: formatDateInTimeZone(previousTo, timeZone),
        campaigns: campaignNames,
        groupBys: ["campaign"],
        sortFieldName: "campaign",
      }).catch((error: unknown) => {
        previousError = error instanceof Error ? error.message : "unknown error";
        return [];
      }),
    ]);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge flyerImage 리포트 집계 실패",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }

  const currentSummary = aggregateSummaryByCampaign({
    rows: currentSummaryRows,
    campaignList,
  });
  const previousSummary = aggregateSummaryByCampaign({
    rows: previousSummaryRows,
    campaignList,
  });
  const currentDaily = aggregateDailyByDate({
    rows: currentDailyRows,
    dates: currentDates,
  });
  const martBreakdowns = aggregateMartBreakdowns({
    rows: currentMartRows,
    martNameMap,
    campaignList,
  });

  const data: FlyerImagesReportData = {
    updated_at: new Date().toISOString(),
    period_days: periodDays,
    comparison_available: !previousError,
    date_range: {
      from: formatDateInTimeZone(currentFrom, timeZone),
      to: formatDateInTimeZone(currentTo, timeZone),
    },
    previous_date_range: {
      from: formatDateInTimeZone(previousFrom, timeZone),
      to: formatDateInTimeZone(previousTo, timeZone),
    },
    campaigns: currentSummary.campaigns.map((campaign) => ({
      ...campaign,
      top_marts: martBreakdowns.campaignTopMartMap.get(campaign.campaign) ?? [],
    })),
    overall_top_marts: martBreakdowns.overall_top_marts,
    daily: currentDaily,
    summary: {
      clicks: {
        current: currentSummary.totals.clicks,
        previous: previousSummary.totals.clicks,
        delta_percentage: calculateDeltaPercentage(
          currentSummary.totals.clicks,
          previousSummary.totals.clicks,
        ),
      },
      impressions: {
        current: currentSummary.totals.impressions,
        previous: previousSummary.totals.impressions,
        delta_percentage: calculateDeltaPercentage(
          currentSummary.totals.impressions,
          previousSummary.totals.impressions,
        ),
      },
      app_installs: {
        current: currentSummary.totals.app_installs,
        previous: previousSummary.totals.app_installs,
        delta_percentage: calculateDeltaPercentage(
          currentSummary.totals.app_installs,
          previousSummary.totals.app_installs,
        ),
      },
      app_deeplink_opens: {
        current: currentSummary.totals.app_deeplink_opens,
        previous: previousSummary.totals.app_deeplink_opens,
        delta_percentage: calculateDeltaPercentage(
          currentSummary.totals.app_deeplink_opens,
          previousSummary.totals.app_deeplink_opens,
        ),
      },
      web_opens: {
        current: currentSummary.totals.web_opens,
        previous: previousSummary.totals.web_opens,
        delta_percentage: calculateDeltaPercentage(
          currentSummary.totals.web_opens,
          previousSummary.totals.web_opens,
        ),
      },
    },
  };

  setCachedReport(cacheKey, data);

  return NextResponse.json({
    success: true,
    data,
    warnings: previousError
      ? [{ type: "previous_period_unavailable", message: previousError }]
      : [],
  });
}
