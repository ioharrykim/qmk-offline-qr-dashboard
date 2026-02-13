import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

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

function extractShortIdFromUrl(shortUrl: string): string | null {
  try {
    const url = new URL(shortUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

function tokenCandidates() {
  const apiToken = process.env.AIRBRIDGE_API_TOKEN?.trim();
  const trackingToken = process.env.AIRBRIDGE_TRACKING_LINK_API_TOKEN?.trim();
  const list = [apiToken, trackingToken].filter(
    (token): token is string => !isTemplateValue(token),
  );
  return Array.from(new Set(list));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type AirbridgeTask = {
  status?: "PENDING" | "RUNNING" | "SUCCESS" | "FAILURE" | "CANCELED";
  taskId?: string;
};

type ReportMeta = {
  metricKeyByLabel: {
    clicks: string;
    impressions: string | null;
    app_installs: string | null;
    app_deeplink_opens: string | null;
    web_opens: string | null;
  };
  reportMetricKeys: string[];
  linkDimension: string;
};

type CachedReportRow = {
  short_url: string;
  report_status: string;
  data: unknown;
  expires_at: string;
};

const REPORT_META_TTL_MS = 10 * 60 * 1000;
const REPORT_CACHE_TABLE = "link_report_cache";
const REPORT_CACHE_SUCCESS_TTL_MS = 15 * 60 * 1000;
const REPORT_CACHE_PENDING_TTL_MS = 20 * 1000;
const REPORT_CACHE_FAIL_TTL_MS = 2 * 60 * 1000;
const reportMetaCache = new Map<string, { expiresAt: number; value: ReportMeta }>();

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function hasActualRows(reportPayload: unknown): boolean {
  const rows = toRecord(toRecord(toRecord(reportPayload)?.actuals)?.data)?.rows;
  return Array.isArray(rows) && rows.length > 0;
}

function extractMetricTotals(
  reportPayload: unknown,
  metricKeys: string[],
): Record<string, number | null> {
  const totals: Record<string, number | null> = {};
  for (const key of metricKeys) totals[key] = null;

  const rows = toRecord(toRecord(toRecord(reportPayload)?.actuals)?.data)?.rows;
  if (!Array.isArray(rows)) return totals;

  for (const row of rows) {
    const values = toRecord(toRecord(row)?.values);
    if (!values) continue;
    for (const key of metricKeys) {
      const metricValue = readMetricValue(values[key]);
      if (metricValue === null) continue;
      totals[key] = (totals[key] ?? 0) + metricValue;
    }
  }

  return totals;
}

function extractGroupByValue(
  reportPayload: unknown,
  groupByKeys: string[],
  targetKey: string,
): string | null {
  const rows = toRecord(toRecord(toRecord(reportPayload)?.actuals)?.data)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const index = groupByKeys.findIndex((key) => key === targetKey);
  if (index < 0) return null;
  const firstRow = toRecord(rows[0]);
  const groupBys = firstRow?.groupBys;
  if (!Array.isArray(groupBys) || groupBys.length <= index) return null;
  const value = groupBys[index];
  return typeof value === "string" && value.trim() ? value : null;
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

function extractItems(payload: unknown): Record<string, unknown>[] {
  const dataValue = toRecord(payload)?.data;
  if (!Array.isArray(dataValue)) return [];

  const flattened: Record<string, unknown>[] = [];
  for (const group of dataValue) {
    const fields = toRecord(group)?.fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (typeof field === "object" && field !== null) {
        flattened.push(field as Record<string, unknown>);
      }
    }
  }
  return flattened;
}

function pickKeyByCandidates(items: Record<string, unknown>[], candidates: string[]) {
  const keys = new Set<string>();
  for (const item of items) {
    const fieldKey = item.key;
    if (typeof fieldKey === "string" && fieldKey.trim().length > 0) {
      keys.add(fieldKey.trim());
    }
  }

  for (const candidate of candidates) {
    if (keys.has(candidate)) {
      return candidate;
    }
  }

  for (const key of Array.from(keys)) {
    const lower = key.toLowerCase();
    if (candidates.some((candidate) => lower.includes(candidate.toLowerCase()))) {
      return key;
    }
  }

  return null;
}

function readMetricValue(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = toRecord(raw);
  const value = record?.value;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getReportCacheTtlMs(reportStatus: string) {
  if (reportStatus === "SUCCESS") return REPORT_CACHE_SUCCESS_TTL_MS;
  if (reportStatus === "PENDING") return REPORT_CACHE_PENDING_TTL_MS;
  return REPORT_CACHE_FAIL_TTL_MS;
}

function shouldIgnoreCacheError(errorMessage: string) {
  const message = errorMessage.toLowerCase();
  return (
    message.includes("relation") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("permission denied") ||
    message.includes("rls")
  );
}

async function readCachedReport(shortUrl: string) {
  const { client } = getSupabaseServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from(REPORT_CACHE_TABLE)
    .select("short_url, report_status, data, expires_at")
    .eq("short_url", shortUrl)
    .maybeSingle();

  if (error) {
    if (!shouldIgnoreCacheError(error.message)) {
      console.warn(`[link-report] cache read failed: ${error.message}`);
    }
    return null;
  }
  if (!data) return null;
  const typedData = data as CachedReportRow;

  const expiresAt = Date.parse(typedData.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  const payload = toRecord(typedData.data);
  if (!payload) return null;
  return payload;
}

async function writeCachedReport(shortUrl: string, reportStatus: string, data: unknown) {
  const { client } = getSupabaseServerClient();
  if (!client) return;

  const ttlMs = getReportCacheTtlMs(reportStatus);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const payload = {
    short_url: shortUrl,
    report_status: reportStatus,
    data,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client
    .from(REPORT_CACHE_TABLE)
    .upsert(payload, { onConflict: "short_url" });

  if (error && !shouldIgnoreCacheError(error.message)) {
    console.warn(`[link-report] cache write failed: ${error.message}`);
  }
}

async function getReportMeta(appName: string, tokenForReport: string): Promise<ReportMeta> {
  const cacheKey = `${appName}:${tokenForReport.slice(0, 8)}`;
  const cached = reportMetaCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { response: metricRes, payload: metricPayload } = await fetchAirbridgeJson(
    `https://api.airbridge.io/dataspec/v2/apps/${encodeURIComponent(appName)}/actual-report/metrics`,
    { method: "GET" },
    tokenForReport,
  );
  if (!metricRes.ok) {
    throw new Error(
      metricPayload?.detail ||
        metricPayload?.title ||
        "Airbridge 리포트 메타데이터(metrics) 조회 실패",
    );
  }

  const metricItems = extractItems(metricPayload);
  const metricKeyByLabel = {
    clicks:
      process.env.AIRBRIDGE_CLICK_METRIC ||
      pickKeyByCandidates(metricItems, ["clicks", "click", "link_click"]) ||
      "clicks",
    impressions: pickKeyByCandidates(metricItems, ["impressions", "impression"]),
    app_installs: pickKeyByCandidates(metricItems, ["app_installs", "installs"]),
    app_deeplink_opens: pickKeyByCandidates(metricItems, ["app_deeplink_opens", "deeplink_opens"]),
    web_opens: pickKeyByCandidates(metricItems, ["web_opens"]),
  };
  const reportMetricKeys = Array.from(
    new Set(Object.values(metricKeyByLabel).filter((key): key is string => Boolean(key))),
  );

  const { response: fieldRes, payload: fieldPayload } = await fetchAirbridgeJson(
    `https://api.airbridge.io/dataspec/v2/apps/${encodeURIComponent(appName)}/actual-report/fields`,
    { method: "GET" },
    tokenForReport,
  );
  if (!fieldRes.ok) {
    throw new Error(
      fieldPayload?.detail ||
        fieldPayload?.title ||
        "Airbridge 리포트 메타데이터(fields) 조회 실패",
    );
  }

  const fieldItems = extractItems(fieldPayload);
  const linkDimension =
    process.env.AIRBRIDGE_LINK_DIMENSION ||
    pickKeyByCandidates(fieldItems, [
      "short_link_id",
      "campaign_short_id",
      "tracking_link_id",
      "tracking_link",
      "tracking_link_short_id",
      "routing_short_id",
      "short_id",
      "shortid",
    ]) ||
    "campaign_short_id";

  const value: ReportMeta = {
    metricKeyByLabel,
    reportMetricKeys,
    linkDimension,
  };

  reportMetaCache.set(cacheKey, { value, expiresAt: Date.now() + REPORT_META_TTL_MS });
  return value;
}

export async function GET(request: NextRequest) {
  const shortUrl = request.nextUrl.searchParams.get("short_url")?.trim() ?? "";
  const airbridgeLinkId = request.nextUrl.searchParams.get("airbridge_link_id")?.trim() ?? "";
  const requestedTaskId = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!shortUrl && !airbridgeLinkId) {
    return NextResponse.json(
      { success: false, message: "short_url 또는 airbridge_link_id가 필요합니다." },
      { status: 400 },
    );
  }

  if (shortUrl && !forceRefresh) {
    const cachedData = await readCachedReport(shortUrl);
    if (cachedData) {
      return NextResponse.json({
        success: true,
        cached: true,
        data: cachedData,
      });
    }
  }

  const appName = process.env.AIRBRIDGE_APP_NAME;
  const tokens = tokenCandidates();

  if (isTemplateValue(appName) || tokens.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge env가 설정되지 않았습니다.",
        detail: "AIRBRIDGE_APP_NAME, AIRBRIDGE_TRACKING_LINK_API_TOKEN(또는 AIRBRIDGE_API_TOKEN) 확인",
      },
      { status: 400 },
    );
  }

  const identifier = airbridgeLinkId || extractShortIdFromUrl(shortUrl);
  const idType = airbridgeLinkId ? "id" : "shortId";

  if (!identifier) {
    return NextResponse.json(
      { success: false, message: "short_url에서 shortId를 추출할 수 없습니다." },
      { status: 400 },
    );
  }

  let detailPayload: unknown = null;
  let detailSuccess = false;
  let detailErrorMessage = "unknown error";
  let usedToken: string | null = null;

  for (const token of tokens) {
    const detailResponse = await fetch(
      `https://api.airbridge.io/v1/tracking-links/${encodeURIComponent(identifier)}?idType=${idType}`,
      {
        method: "GET",
        headers: {
          "Accept-Language": "ko",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );
    const payload = await detailResponse.json();

    if (detailResponse.ok) {
      detailPayload = payload;
      detailSuccess = true;
      usedToken = token;
      break;
    }

    detailErrorMessage =
      payload?.detail ||
      payload?.title ||
      payload?.message ||
      `status ${detailResponse.status}`;
  }

  if (!detailSuccess) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge tracking link 조회 실패",
        detail: detailErrorMessage,
      },
      { status: 502 },
    );
  }

  const detailData = toRecord(toRecord(detailPayload)?.data);
  const detailShortId = (detailData?.shortId as string | undefined) ?? null;
  const detailTrackingLinkId =
    detailData?.id !== undefined && detailData?.id !== null
      ? String(detailData.id)
      : null;

  // Best-effort: Airbridge 리포트 API(actuals)로 클릭 메트릭 조회 시도.
  // 계정/권한/메트릭명에 따라 실패할 수 있으므로 실패 시 null 반환.
  let clickCount: number | null = null;
  let reportStatus = "UNAVAILABLE";
  let reportMessage = "";
  let reportTaskId: string | null = requestedTaskId || null;
  let reportMetrics: Record<string, number | null> = {
    clicks: null,
    impressions: null,
    app_installs: null,
    app_deeplink_opens: null,
    web_opens: null,
  };
  let reportDimensions: Record<string, string | null> = {
    channel_type: null,
    channel: null,
    campaign: null,
    ad_group: null,
    ad_creative: null,
  };

  try {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 30);

    const yyyyMmDd = (date: Date) => date.toISOString().slice(0, 10);

    const tokenForReport = usedToken || tokens[0];

    let meta: ReportMeta | null = null;
    try {
      meta = await getReportMeta(appName as string, tokenForReport);
    } catch (error) {
      reportStatus = "UNAVAILABLE";
      reportMessage = error instanceof Error ? error.message : "리포트 메타 조회 실패";
    }

    if (!meta) {
      throw new Error(reportMessage || "리포트 메타 조회 실패");
    }

    const { metricKeyByLabel, reportMetricKeys, linkDimension } = meta;
    if (reportMetricKeys.length === 0 || !linkDimension) {
      reportStatus = "UNAVAILABLE";
      reportMessage =
        "리포트용 metric 또는 link dimension 키를 찾지 못했습니다. AIRBRIDGE_CLICK_METRIC / AIRBRIDGE_LINK_DIMENSION 설정을 확인하세요.";
    } else {
      const filterValues = Array.from(
        new Set(
          [identifier, detailShortId, detailTrackingLinkId].filter(
            (value): value is string => Boolean(value && value.trim()),
          ),
        ),
      );

      const reportGroupBys = [
        linkDimension,
        "channel_type",
        "channel",
        "campaign",
        "ad_group",
        "ad_creative",
      ];

      let activeTaskId = requestedTaskId || "";

      if (!activeTaskId) {
        const { response: startResponse, payload: startPayload } = await fetchAirbridgeJson(
          `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query`,
          {
            method: "POST",
            body: JSON.stringify({
              from: yyyyMmDd(from),
              to: yyyyMmDd(today),
              metrics: reportMetricKeys,
              groupBys: reportGroupBys,
              sorts: [
                {
                  fieldName: linkDimension,
                  isAscending: true,
                },
              ],
              filters: [
                {
                  dimension: linkDimension,
                  filterType: "IN",
                  values: filterValues,
                },
              ],
            }),
          },
          tokenForReport,
        );

        const task = (toRecord(startPayload)?.task || {}) as AirbridgeTask;
        if (!startResponse.ok || !task.taskId) {
          const rawMessage =
            toRecord(startPayload)?.detail?.toString() ||
            toRecord(startPayload)?.title?.toString() ||
            "Airbridge actual-report query 시작 실패";
          if (rawMessage.toLowerCase().includes("requested url was not found")) {
            reportStatus = "UNSUPPORTED";
            reportMessage =
              "현재 계정/토큰에서는 클릭 리포트 API 엔드포인트가 제공되지 않습니다. Airbridge 지원 문서의 링크 클릭 리포트 전용 엔드포인트/권한 확인이 필요합니다.";
          } else {
            reportStatus = "UNAVAILABLE";
            reportMessage = rawMessage;
          }
        } else {
          activeTaskId = task.taskId;
          reportTaskId = task.taskId;
        }
      }

      if (!(activeTaskId && reportStatus === "UNAVAILABLE" && reportMessage) && activeTaskId) {
        let reportPayload: unknown = null;
        let finalStatus: AirbridgeTask["status"] = "PENDING";
        const maxPoll = requestedTaskId ? 1 : 2;

        for (let i = 0; i < maxPoll; i += 1) {
          const polled = await fetchAirbridgeJson(
            `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query/${activeTaskId}`,
            { method: "GET" },
            tokenForReport,
          );

          reportPayload = polled.payload;
          finalStatus = (toRecord(polled.payload)?.task as AirbridgeTask | undefined)?.status;

          if (finalStatus === "SUCCESS" || finalStatus === "FAILURE" || finalStatus === "CANCELED") {
            break;
          }
          await sleep(1000);
        }

        if (finalStatus === "SUCCESS") {
          const totals = extractMetricTotals(reportPayload, reportMetricKeys);
          reportMetrics = {
            clicks: metricKeyByLabel.clicks ? totals[metricKeyByLabel.clicks] ?? 0 : null,
            impressions: metricKeyByLabel.impressions
              ? totals[metricKeyByLabel.impressions] ?? 0
              : null,
            app_installs: metricKeyByLabel.app_installs
              ? totals[metricKeyByLabel.app_installs] ?? 0
              : null,
            app_deeplink_opens: metricKeyByLabel.app_deeplink_opens
              ? totals[metricKeyByLabel.app_deeplink_opens] ?? 0
              : null,
            web_opens: metricKeyByLabel.web_opens ? totals[metricKeyByLabel.web_opens] ?? 0 : null,
          };
          clickCount = reportMetrics.clicks;
          reportDimensions = {
            channel_type: extractGroupByValue(reportPayload, reportGroupBys, "channel_type"),
            channel: extractGroupByValue(reportPayload, reportGroupBys, "channel"),
            campaign: extractGroupByValue(reportPayload, reportGroupBys, "campaign"),
            ad_group: extractGroupByValue(reportPayload, reportGroupBys, "ad_group"),
            ad_creative: extractGroupByValue(reportPayload, reportGroupBys, "ad_creative"),
          };
          if ((clickCount === null || !hasActualRows(reportPayload)) && detailData) {
            const campaignParams = toRecord(detailData.campaignParams);
            const channelName =
              typeof detailData.channelName === "string" ? detailData.channelName : null;
            const campaign =
              typeof campaignParams?.campaign === "string" ? campaignParams.campaign : null;
            const adGroup =
              typeof campaignParams?.adGroup === "string"
                ? campaignParams.adGroup
                : typeof campaignParams?.ad_group === "string"
                  ? campaignParams.ad_group
                  : null;
            const adCreative =
              typeof campaignParams?.adCreative === "string"
                ? campaignParams.adCreative
                : typeof campaignParams?.ad_creative === "string"
                  ? campaignParams.ad_creative
                  : null;

            const fallbackFilters = [
              { dimension: "channel", value: channelName },
              { dimension: "campaign", value: campaign },
              { dimension: "ad_group", value: adGroup },
              { dimension: "ad_creative", value: adCreative },
            ].filter(
              (item): item is { dimension: string; value: string } =>
                Boolean(item.value && item.value.trim()),
            );

            if (fallbackFilters.length > 0) {
              const fallbackBody = {
                from: yyyyMmDd(from),
                to: yyyyMmDd(today),
                granularity: "day",
                metrics: reportMetricKeys,
                groupBys: fallbackFilters.map((item) => item.dimension),
                sorts: [
                  {
                    fieldName: fallbackFilters[0].dimension,
                    isAscending: true,
                  },
                ],
                filters: fallbackFilters.map((item) => ({
                  dimension: item.dimension,
                  filterType: "IN",
                  values: [item.value],
                })),
              };

              const startFallback = await fetchAirbridgeJson(
                `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query`,
                {
                  method: "POST",
                  body: JSON.stringify(fallbackBody),
                },
                tokenForReport,
              );

              const fallbackTask = (toRecord(startFallback.payload)?.task || {}) as AirbridgeTask;
              if (startFallback.response.ok && fallbackTask.taskId) {
                let fallbackPayload: unknown = null;
                let fallbackStatus: AirbridgeTask["status"] = fallbackTask.status;

                for (let i = 0; i < 20; i += 1) {
                  const polledFallback = await fetchAirbridgeJson(
                    `https://api.airbridge.io/reports/api/v7/apps/${encodeURIComponent(appName as string)}/actuals/query/${fallbackTask.taskId}`,
                    { method: "GET" },
                    tokenForReport,
                  );
                  fallbackPayload = polledFallback.payload;
                  fallbackStatus = (toRecord(polledFallback.payload)?.task as AirbridgeTask | undefined)?.status;
                  if (
                    fallbackStatus === "SUCCESS" ||
                    fallbackStatus === "FAILURE" ||
                    fallbackStatus === "CANCELED"
                  ) {
                    break;
                  }
                  await sleep(1000);
                }

                if (fallbackStatus === "SUCCESS") {
                  const fallbackTotals = extractMetricTotals(
                    fallbackPayload,
                    reportMetricKeys,
                  );
                  const fallbackMetrics = {
                    clicks: metricKeyByLabel.clicks
                      ? fallbackTotals[metricKeyByLabel.clicks] ?? 0
                      : null,
                    impressions: metricKeyByLabel.impressions
                      ? fallbackTotals[metricKeyByLabel.impressions] ?? 0
                      : null,
                    app_installs: metricKeyByLabel.app_installs
                      ? fallbackTotals[metricKeyByLabel.app_installs] ?? 0
                      : null,
                    app_deeplink_opens: metricKeyByLabel.app_deeplink_opens
                      ? fallbackTotals[metricKeyByLabel.app_deeplink_opens] ?? 0
                      : null,
                    web_opens: metricKeyByLabel.web_opens
                      ? fallbackTotals[metricKeyByLabel.web_opens] ?? 0
                      : null,
                  };
                  if (fallbackMetrics.clicks !== null) {
                    reportMetrics = fallbackMetrics;
                    clickCount = fallbackMetrics.clicks;
                    reportDimensions = {
                      channel_type: "Custom Channel",
                      channel: channelName,
                      campaign,
                      ad_group: adGroup,
                      ad_creative: adCreative,
                    };
                  }
                }
              }
            }
          }
          if (clickCount === null) {
            clickCount = 0;
          }
          reportStatus = "SUCCESS";
          reportMessage =
            clickCount === 0
              ? "조회 기간 내 해당 링크 클릭 데이터가 없습니다."
              : "";
        } else {
          const rawMessage =
            toRecord(reportPayload)?.detail?.toString() ||
            "리포트 집계가 완료되지 않았습니다.";
          if (rawMessage.toLowerCase().includes("requested url was not found")) {
            reportStatus = "UNSUPPORTED";
            reportMessage =
              "현재 계정/토큰에서는 클릭 리포트 API 엔드포인트가 제공되지 않습니다. Airbridge 지원 문서의 링크 클릭 리포트 전용 엔드포인트/권한 확인이 필요합니다.";
          } else if (finalStatus === "FAILURE" || finalStatus === "CANCELED") {
            reportStatus = finalStatus;
            reportMessage = rawMessage;
          } else {
            reportStatus = "PENDING";
            reportMessage = "리포트 집계가 진행 중입니다. 잠시 후 다시 조회해 주세요.";
          }
        }
      }
    }
  } catch (error) {
    reportStatus = "UNAVAILABLE";
    reportMessage = error instanceof Error ? error.message : "unknown error";
  }

  const responseData = {
    idType,
    identifier,
    task_id: reportTaskId,
    click_count: clickCount,
    report_status: reportStatus,
    report_message: reportMessage,
    report_metrics: reportMetrics,
    report_dimensions: reportDimensions,
    tracking_link: {
      id: toRecord(toRecord(detailPayload)?.data)?.id ?? null,
      short_url: (toRecord(toRecord(detailPayload)?.data)?.shortUrl as string) ?? shortUrl,
      short_id: (toRecord(toRecord(detailPayload)?.data)?.shortId as string) ?? null,
      channel_name: (toRecord(toRecord(detailPayload)?.data)?.channelName as string) ?? null,
      campaign_params:
        (toRecord(toRecord(detailPayload)?.data)?.campaignParams as Record<string, unknown>) ??
        null,
    },
  };

  const cacheShortUrl = responseData.tracking_link.short_url || shortUrl;
  if (cacheShortUrl) {
    await writeCachedReport(cacheShortUrl, reportStatus, responseData);
  }

  return NextResponse.json({
    success: true,
    data: responseData,
  });
}
