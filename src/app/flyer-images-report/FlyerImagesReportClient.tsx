"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import DashboardHeaderNav from "@/components/DashboardHeaderNav";

type DashboardMetricKey =
  | "clicks"
  | "impressions"
  | "app_installs"
  | "app_deeplink_opens"
  | "web_opens";

type DashboardMetricBucket = Record<DashboardMetricKey, number>;

type DashboardMetricSummary = {
  current: number;
  previous: number;
  delta_percentage: number | null;
};

type DashboardMartBreakdown = {
  mart_code: string | null;
  mart_name: string;
} & DashboardMetricBucket;

type FlyerImageCampaignPerformance = {
  campaign: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  accent: string;
  top_marts: DashboardMartBreakdown[];
} & DashboardMetricBucket;

type FlyerImagesReportResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  warnings?: Array<{
    type: string;
    message: string;
  }>;
  data?: {
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
    overall_top_marts: DashboardMartBreakdown[];
    daily: Array<
      {
        date: string;
        top_marts: DashboardMartBreakdown[];
      } & DashboardMetricBucket
    >;
    summary: Record<DashboardMetricKey, DashboardMetricSummary>;
  };
};

type HoverDetail = {
  title: string;
  subtitle: string;
  marts: DashboardMartBreakdown[];
};

const METRIC_META = [
  { key: "clicks", label: "Clicks", tone: "orange" },
  { key: "app_installs", label: "Installs (App)", tone: "green" },
  { key: "impressions", label: "Impressions", tone: "yellow" },
  { key: "app_deeplink_opens", label: "Deeplink Opens (App)", tone: "orange" },
  { key: "web_opens", label: "Opens (Web)", tone: "blue" },
] as const;

function formatMetricNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function formatDeltaLabel(value: number | null) {
  if (value === null) return "신규";
  if (value === 0) return "변동 없음";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function getDeltaToneClass(value: number | null) {
  if (value === null || value > 0) return "text-[#00724C] bg-[#E6F5EF] border-[#66C2A0]";
  if (value < 0) return "text-[#B83232] bg-[#FDECEC] border-[#E53E3E]/30";
  return "text-[#6B6E75] bg-[#F4F4F5] border-[#E0E1E3]";
}

function formatDashboardDateLabel(value: string) {
  return value.slice(5).replace("-", ".");
}

function buildTrendPath(
  values: number[],
  width: number,
  height: number,
  padding: number,
  maxValue: number,
) {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const y = height - padding - (values[0] / maxValue) * (height - padding * 2);
    return `M ${padding} ${y}`;
  }

  return values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - (value / maxValue) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function FlyerTrendChart({
  points,
  onHoverPoint,
}: {
  points: Array<{
    date: string;
    clicks: number;
    app_installs: number;
    top_marts: DashboardMartBreakdown[];
  }>;
  onHoverPoint?: (point: {
    date: string;
    clicks: number;
    app_installs: number;
    top_marts: DashboardMartBreakdown[];
  }) => void;
}) {
  const width = 640;
  const height = 240;
  const padding = 24;
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [point.clicks, point.app_installs]),
  );
  const clicksPath = buildTrendPath(
    points.map((point) => point.clicks),
    width,
    height,
    padding,
    maxValue,
  );
  const installsPath = buildTrendPath(
    points.map((point) => point.app_installs),
    width,
    height,
    padding,
    maxValue,
  );

  return (
    <div className="rounded-3xl border border-[#E0E1E3] bg-white p-5 shadow-[0_12px_40px_rgba(18,20,23,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#121417]">일자별 추이</p>
          <p className="mt-1 text-xs text-[#6B6E75]">
            이미지 다운로드 링크의 클릭과 설치 흐름을 함께 봅니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#6B6E75]">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF4800]" />
            Clicks
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#00724C]" />
            Installs (App)
          </span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-3xl border border-[#FFE4D6] bg-gradient-to-b from-[#FFF9F5] to-white p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
          {[0.25, 0.5, 0.75].map((ratio, index) => {
            const y = padding + (height - padding * 2) * ratio;
            return (
              <line
                key={index}
                x1={padding}
                x2={width - padding}
                y1={y}
                y2={y}
                stroke="#F4D6C8"
                strokeDasharray="4 6"
              />
            );
          })}
          <path
            d={clicksPath}
            fill="none"
            stroke="#FF4800"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={installsPath}
            fill="none"
            stroke="#00724C"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => {
            const x =
              points.length === 1
                ? width / 2
                : padding + (index / (points.length - 1)) * (width - padding * 2);
            const clicksY =
              height - padding - (point.clicks / maxValue) * (height - padding * 2);
            const installsY =
              height -
              padding -
              (point.app_installs / maxValue) * (height - padding * 2);

            return (
              <g
                key={point.date}
                onMouseEnter={() => onHoverPoint?.(point)}
                onFocus={() => onHoverPoint?.(point)}
                className="cursor-pointer"
              >
                <circle cx={x} cy={clicksY} r="14" fill="transparent" />
                <circle cx={x} cy={installsY} r="14" fill="transparent" />
                <circle cx={x} cy={clicksY} r="4.5" fill="#FF4800" />
                <circle cx={x} cy={installsY} r="4.5" fill="#00724C" />
              </g>
            );
          })}
        </svg>

        <div className="mt-2 flex items-center justify-between text-[11px] text-[#6B6E75]">
          <span>{points[0] ? formatDashboardDateLabel(points[0].date) : "-"}</span>
          <span>
            {points[Math.floor(points.length / 2)]
              ? formatDashboardDateLabel(points[Math.floor(points.length / 2)].date)
              : "-"}
          </span>
          <span>
            {points[points.length - 1]
              ? formatDashboardDateLabel(points[points.length - 1].date)
              : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}

function buildHoverDetailFromCampaign(
  campaign: FlyerImageCampaignPerformance,
  periodLabel: string,
): HoverDetail {
  return {
    title: `${campaign.title} 상위 마트`,
    subtitle: `Clicks ${formatMetricNumber(campaign.clicks)} · ${periodLabel} 기준`,
    marts: campaign.top_marts,
  };
}

export default function FlyerImagesReportClient() {
  const [period, setPeriod] = useState<"30d" | "90d" | "400d">("400d");
  const [report, setReport] = useState<FlyerImagesReportResponse["data"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [hoverDetail, setHoverDetail] = useState<HoverDetail | null>(null);

  const loadReport = useCallback(
    async (nextPeriod: "30d" | "90d" | "400d", refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(`/api/flyer-images-report?period=${nextPeriod}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as FlyerImagesReportResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.detail || payload.message || "리포트를 불러오지 못했습니다.");
        }

        setReport(payload.data);
        setWarning(payload.warnings?.[0]?.message ?? null);

        const topCampaign = payload.data.campaigns[0];
        setHoverDetail(
          topCampaign
            ? buildHoverDetailFromCampaign(
                topCampaign,
                nextPeriod === "30d" ? "최근 30일" : nextPeriod === "90d" ? "최근 90일" : "최근 400일",
              )
            : {
                title: "전체 상위 마트",
                subtitle: "집계 데이터가 아직 없습니다.",
                marts: payload.data.overall_top_marts,
              },
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadReport(period);
  }, [period, loadReport]);

  const trendPoints = useMemo(
    () =>
      (report?.daily ?? []).map((point) => ({
        date: point.date,
        clicks: point.clicks,
        app_installs: point.app_installs,
        top_marts: point.top_marts,
      })),
    [report?.daily],
  );

  const periodLabel = period === "30d" ? "최근 30일" : period === "90d" ? "최근 90일" : "최근 400일";

  return (
    <main className="qmk-surface min-h-screen text-[#121417]">
      <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
        <DashboardHeaderNav />
      </div>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-[#E0E1E3] bg-white px-6 py-7 shadow-[0_18px_60px_rgba(18,20,23,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center rounded-full border border-[#FFD8C7] bg-[#FFF5F0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FF6D33]">
                QMARKET PARTNERS ASSET
              </div>
              <h1 className="mt-4 text-3xl font-bold text-[#121417]">
                전단 이미지 성과 리포트
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6E75]">
                큐마켓 파트너스에서 내려받아 활용하는 flyerImage 자산 8종의 실시간 Airbridge
                성과를 한 번에 봅니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#6B6E75]">
                <span className="rounded-full border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-1.5">
                  Campaign 기준 8종
                </span>
                <span className="rounded-full border border-[#66C2A0] bg-[#E6F5EF] px-3 py-1.5 text-[#004D33]">
                  실시간 집계
                </span>
                {report ? (
                  <span className="rounded-full border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-1.5">
                    업데이트 {format(new Date(report.updated_at), "yyyy-MM-dd HH:mm")}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadReport(period, true)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                새로고침
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-[#E0E1E3] bg-[radial-gradient(circle_at_top_left,_rgba(255,72,0,0.12),_transparent_35%),linear-gradient(135deg,#fff7f1_0%,#ffffff_48%,#fff5e0_100%)] p-5 shadow-[0_14px_40px_rgba(18,20,23,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FF6D33]">
                FLYER IMAGE PERFORMANCE
              </p>
              <h2 className="mt-2 text-xl font-bold text-[#121417]">
                이미지 자산별 주간/월간 성과
              </h2>
              <p className="mt-1 text-sm text-[#6B6E75]">
                Campaign 필터 기준으로 flyerImage 자산만 집계합니다.
              </p>
            </div>

            <div className="inline-flex rounded-2xl border border-[#E0E1E3] bg-white/80 p-1 text-sm shadow-[0_8px_20px_rgba(18,20,23,0.04)]">
              {(["30d", "90d", "400d"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPeriod(option)}
                  className={`rounded-xl px-3 py-2 ${
                    period === option
                      ? "bg-[#121417] font-semibold text-white"
                      : "text-[#6B6E75]"
                  }`}
                >
                  {option === "30d" ? "최근 30일" : option === "90d" ? "최근 90일" : "최근 400일"}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/80" />
                ))}
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
                <div className="h-80 animate-pulse rounded-2xl bg-white/80" />
                <div className="h-80 animate-pulse rounded-2xl bg-white/80" />
              </div>
            </div>
          ) : error ? (
            <div className="mt-5 rounded-2xl border border-[#E53E3E]/30 bg-[#FDECEC] px-4 py-3 text-sm text-[#B83232]">
              {error}
            </div>
          ) : report ? (
            <div className="mt-5 space-y-4">
              {warning ? (
                <div className="rounded-2xl border border-[#FFD580] bg-[#FFF5E0] px-4 py-3 text-sm text-[#8A5C00]">
                  이전 기간 비교 데이터 일부를 가져오지 못했습니다. 현재 기간 데이터는 정상적으로 표시됩니다.
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {METRIC_META.map((item) => {
                  const metric = report.summary[item.key];
                  const toneClasses =
                    item.tone === "green"
                      ? "from-[#E6F5EF] to-white border-[#66C2A0]"
                      : item.tone === "yellow"
                        ? "from-[#FFF5E0] to-white border-[#FFD580]"
                        : item.tone === "blue"
                          ? "from-[#EEF5FF] to-white border-[#BFD8F6]"
                          : "from-[#FFF0EB] to-white border-[#FF9E73]";

                  return (
                    <div
                      key={item.key}
                      className={`rounded-2xl border bg-gradient-to-br p-4 shadow-[0_10px_24px_rgba(18,20,23,0.04)] ${toneClasses}`}
                    >
                      <p className="text-xs uppercase tracking-[0.14em] text-[#6B6E75]">
                        {item.label}
                      </p>
                      <p className="mt-3 text-3xl font-bold text-[#121417]">
                        {formatMetricNumber(metric.current)}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`rounded-full border px-2 py-1 font-semibold ${getDeltaToneClass(metric.delta_percentage)}`}
                        >
                          {report.comparison_available
                            ? formatDeltaLabel(metric.delta_percentage)
                            : "비교 없음"}
                        </span>
                        <span className="text-[#6B6E75]">
                          이전 {formatMetricNumber(metric.previous)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
                <FlyerTrendChart
                  points={trendPoints}
                  onHoverPoint={(point) =>
                    setHoverDetail({
                      title: `${formatDashboardDateLabel(point.date)} 상위 마트`,
                      subtitle: `Clicks ${formatMetricNumber(point.clicks)} · Installs ${formatMetricNumber(point.app_installs)}`,
                      marts: point.top_marts,
                    })
                  }
                />

                <div className="rounded-3xl border border-[#E0E1E3] bg-white p-5 shadow-[0_12px_40px_rgba(18,20,23,0.06)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#121417]">
                        {hoverDetail?.title ?? "전체 상위 마트"}
                      </p>
                      <p className="mt-1 text-xs text-[#6B6E75]">
                        {hoverDetail?.subtitle ??
                          `${periodLabel} 기준 상위 기여 마트를 보여드립니다.`}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#E0E1E3] bg-[#F8F8F9] px-2 py-1 text-[10px] font-medium text-[#6B6E75]">
                      마우스 오버
                    </span>
                  </div>

                  {(hoverDetail?.marts ?? report.overall_top_marts).length ? (
                    <div className="mt-4 space-y-3">
                      {(hoverDetail?.marts ?? report.overall_top_marts).map((mart, index) => (
                        <div
                          key={`${mart.mart_code ?? mart.mart_name}-${index}`}
                          className="rounded-2xl border border-[#EAECEF] bg-[#FCFCFD] px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-[#121417]">
                                {mart.mart_name}
                              </p>
                              <p className="mt-0.5 text-[11px] text-[#6B6E75]">
                                {mart.mart_code ?? "마트 코드 없음"}
                              </p>
                            </div>
                            <div className="text-right text-[11px] text-[#6B6E75]">
                              <p>Clicks {formatMetricNumber(mart.clicks)}</p>
                              <p>Installs {formatMetricNumber(mart.app_installs)}</p>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#6B6E75]">
                            <span>Impressions {formatMetricNumber(mart.impressions)}</span>
                            <span>Deeplink {formatMetricNumber(mart.app_deeplink_opens)}</span>
                            <span>Web Opens {formatMetricNumber(mart.web_opens)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-[#E0E1E3] bg-[#F8F8F9] px-4 py-8 text-center text-sm text-[#6B6E75]">
                      아직 표시할 마트별 데이터가 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-[32px] border border-[#E0E1E3] bg-white p-5 shadow-[0_14px_40px_rgba(18,20,23,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#121417]">이미지별 성과 카드</p>
              <p className="mt-1 text-xs text-[#6B6E75]">
                카드에 마우스를 올리면 해당 이미지 기준 상위 마트를 오른쪽 패널에서 계속 볼 수 있습니다.
              </p>
            </div>
            {report ? (
              <span className="rounded-full border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-1 text-xs text-[#6B6E75]">
                {report.date_range.from} ~ {report.date_range.to}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-72 animate-pulse rounded-3xl bg-[#F8F8F9]" />
              ))}
            </div>
          ) : report?.campaigns?.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {report.campaigns.map((campaign) => (
                <article
                  key={campaign.campaign}
                  onMouseEnter={() => setHoverDetail(buildHoverDetailFromCampaign(campaign, periodLabel))}
                  className="group rounded-[28px] border border-[#E0E1E3] bg-[#FCFCFD] p-4 shadow-[0_10px_30px_rgba(18,20,23,0.04)]"
                >
                  <div
                    className="relative overflow-hidden rounded-[24px] border border-white/80"
                    style={{
                      background: `linear-gradient(140deg, ${campaign.accent}22 0%, rgba(255,255,255,0.92) 55%, ${campaign.accent}12 100%)`,
                    }}
                  >
                    {campaign.imageUrl ? (
                      <img
                        src={campaign.imageUrl}
                        alt={campaign.title}
                        className="h-44 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-44 w-full flex-col items-center justify-center gap-2">
                        <div
                          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg"
                          style={{ backgroundColor: campaign.accent }}
                        >
                          <ImageIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-semibold text-[#121417]">{campaign.title}</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-[#121417]">
                          {campaign.title}
                        </p>
                        <p className="mt-1 text-xs text-[#6B6E75]">{campaign.subtitle}</p>
                      </div>
                      <div
                        className="h-3 w-3 rounded-full shadow-[0_0_0_6px_rgba(255,255,255,0.8)]"
                        style={{ backgroundColor: campaign.accent }}
                      />
                    </div>

                    <p className="mt-3 line-clamp-1 text-[11px] text-[#6B6E75]">
                      {campaign.campaign}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3 text-sm">
                      <div>
                        <p className="text-[11px] text-[#6B6E75]">Clicks</p>
                        <p className="mt-1 text-xl font-bold text-[#121417]">
                          {formatMetricNumber(campaign.clicks)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#6B6E75]">Installs</p>
                        <p className="mt-1 text-xl font-bold text-[#121417]">
                          {formatMetricNumber(campaign.app_installs)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2 text-[11px] text-[#6B6E75]">
                      <div className="flex items-center justify-between">
                        <span>Impressions</span>
                        <span>{formatMetricNumber(campaign.impressions)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Deeplink Opens (App)</span>
                        <span>{formatMetricNumber(campaign.app_deeplink_opens)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Opens (Web)</span>
                        <span>{formatMetricNumber(campaign.web_opens)}</span>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-[#EFF0F1] pt-3">
                      <p className="text-[11px] font-medium text-[#6B6E75]">상위 마트</p>
                      {campaign.top_marts.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {campaign.top_marts.slice(0, 3).map((mart) => (
                            <span
                              key={`${campaign.campaign}-${mart.mart_code ?? mart.mart_name}`}
                              className="rounded-full border border-[#E0E1E3] bg-white px-2.5 py-1 text-[11px] text-[#2E3035]"
                            >
                              {mart.mart_name} · {formatMetricNumber(mart.clicks)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] text-[#A0A3A9]">기여 마트 데이터 없음</p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-[#E0E1E3] bg-[#F8F8F9] px-4 py-10 text-center text-sm text-[#6B6E75]">
              아직 집계된 flyerImage 데이터가 없습니다.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
