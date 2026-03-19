"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Copy, ExternalLink, RefreshCw, Search } from "lucide-react";

import { buildCampaignReportPath } from "@/lib/campaignReport";

type CampaignLinkResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  data?: {
    campaign_name: string;
    short_url: string;
    created_at: string;
    mart_code: string;
    ad_creative: string;
    airbridge_link_id: string | null;
  };
};

type LinkReportResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  data?: {
    idType: string;
    identifier: string;
    task_id: string | null;
    click_count: number | null;
    report_status: string;
    report_message: string;
    report_metrics: {
      clicks: number | null;
      impressions: number | null;
      app_installs: number | null;
      app_deeplink_opens: number | null;
      web_opens: number | null;
    };
    report_dimensions: {
      channel_type: string | null;
      channel: string | null;
      campaign: string | null;
      ad_group: string | null;
      ad_creative: string | null;
    };
    tracking_link: {
      id: string | number | null;
      short_url: string;
      short_id: string | null;
      channel_name: string | null;
      campaign_params: Record<string, unknown> | null;
    };
  };
};

function formatMetricNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function getStatusTone(status: string) {
  if (status === "SUCCESS") return "bg-[#E6F5EF] text-[#004D33]";
  if (status === "PENDING") return "bg-[#FFF5E0] text-[#CC8200]";
  return "bg-[#FDECEC] text-[#B83232]";
}

export default function CampaignReportClient({
  initialCampaign,
}: {
  initialCampaign?: string;
}) {
  const router = useRouter();
  const [campaignInput, setCampaignInput] = useState(initialCampaign ?? "");
  const [campaign, setCampaign] = useState(initialCampaign ?? "");
  const [isLoading, setIsLoading] = useState(Boolean(initialCampaign));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkData, setLinkData] = useState<CampaignLinkResponse["data"] | null>(null);
  const [reportData, setReportData] = useState<LinkReportResponse["data"] | null>(null);

  const loadReport = useCallback(
    async (campaignName: string, forceRefresh = true) => {
      if (!campaignName.trim()) {
        setError("캠페인명을 입력해주세요.");
        setLinkData(null);
        setReportData(null);
        return;
      }

      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const linkResponse = await fetch(
          `/api/campaign-link?campaign=${encodeURIComponent(campaignName)}`,
          { cache: "no-store" },
        );
        const linkPayload = (await linkResponse.json()) as CampaignLinkResponse;

        if (!linkResponse.ok || !linkPayload.success || !linkPayload.data) {
          throw new Error(
            linkPayload.detail ||
              linkPayload.message ||
              "캠페인에 연결된 링크를 찾지 못했습니다.",
          );
        }

        setLinkData(linkPayload.data);

        const fetchReport = async (taskId?: string) => {
          const params = new URLSearchParams({
            short_url: linkPayload.data!.short_url,
            refresh: forceRefresh ? "1" : "0",
          });
          if (linkPayload.data?.airbridge_link_id) {
            params.set("airbridge_link_id", linkPayload.data.airbridge_link_id);
          }
          if (taskId) {
            params.set("task_id", taskId);
          }

          const response = await fetch(`/api/link-report?${params.toString()}`, {
            cache: "no-store",
          });
          const payload = (await response.json()) as LinkReportResponse;
          if (!response.ok || !payload.success || !payload.data) {
            throw new Error(payload.detail || payload.message || "리포트를 불러오지 못했습니다.");
          }
          return payload.data;
        };

        let nextReport = await fetchReport();
        let attempt = 0;
        while (
          nextReport.report_status === "PENDING" &&
          nextReport.task_id &&
          attempt < 5
        ) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          nextReport = await fetchReport(nextReport.task_id);
          attempt += 1;
        }

        setReportData(nextReport);
      } catch (loadError) {
        setLinkData(null);
        setReportData(null);
        setError(loadError instanceof Error ? loadError.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!initialCampaign) return;
    void loadReport(initialCampaign, true);
  }, [initialCampaign, loadReport]);

  const shareUrl = useMemo(() => {
    if (!campaign) return "";
    if (typeof window === "undefined") return buildCampaignReportPath(campaign);
    return `${window.location.origin}${buildCampaignReportPath(campaign)}`;
  }, [campaign]);

  async function handleCopy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCampaign = campaignInput.trim();
    if (!nextCampaign) return;
    setCampaign(nextCampaign);
    router.push(buildCampaignReportPath(nextCampaign));
    void loadReport(nextCampaign, true);
  }

  return (
    <main className="qmk-surface min-h-screen text-[#121417]">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <section className="rounded-[28px] border border-[#E0E1E3] bg-white px-6 py-6 shadow-[0_16px_48px_rgba(18,20,23,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center rounded-full border border-[#FFD8C7] bg-[#FFF5F0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FF6D33]">
                  QMARKET CAMPAIGN REPORT
                </div>
                <h1 className="mt-4 text-3xl font-bold text-[#121417]">단일 캠페인 실시간 리포트</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6B6E75]">
                  캠페인명 하나로 해당 링크의 Airbridge 성과를 실시간 조회할 수 있는 공유용 페이지입니다.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl border border-[#E0E1E3] bg-white px-4 py-2.5 text-sm font-medium text-[#121417] hover:border-[#FF9E73] hover:bg-[#FFF5F0]"
              >
                <ArrowLeft className="h-4 w-4" />
                메인으로
              </Link>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A3A9]" />
                <input
                  value={campaignInput}
                  onChange={(event) => setCampaignInput(event.target.value)}
                  placeholder="예: 260317_seilsyopingmart_baegot_tvcf"
                  className="w-full rounded-2xl border border-[#E0E1E3] bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#FF6D33]"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl bg-[#FF4800] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#CC3A00]"
              >
                리포트 보기
              </button>
              <button
                type="button"
                onClick={() => campaign && void loadReport(campaign, true)}
                disabled={!campaign || isLoading || isRefreshing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#E0E1E3] bg-white px-5 py-3 text-sm font-medium text-[#121417] transition hover:border-[#FF9E73] hover:bg-[#FFF5F0] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${(isLoading || isRefreshing) ? "animate-spin" : ""}`} />
                새로고침
              </button>
            </form>

            {campaign ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#6B6E75]">
                <span className="rounded-full border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-1.5">
                  현재 캠페인 {campaign}
                </span>
                {shareUrl ? (
                  <button
                    type="button"
                    onClick={() => void handleCopy(shareUrl, "share")}
                    className="inline-flex items-center gap-1 rounded-full border border-[#E0E1E3] bg-white px-3 py-1.5 hover:border-[#FF9E73] hover:bg-[#FFF5F0]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied === "share" ? "링크 복사됨" : "공유 링크 복사"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          {isLoading ? (
            <section className="rounded-[28px] border border-[#FFD8C7] bg-gradient-to-br from-white to-[#FFF5E0] p-6 shadow-[0_16px_48px_rgba(255,72,0,0.08)]">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/80" />
                ))}
              </div>
            </section>
          ) : error ? (
            <section className="rounded-2xl border border-[#E53E3E]/30 bg-[#FDECEC] px-4 py-4 text-sm text-[#B83232]">
              {error}
            </section>
          ) : linkData && reportData ? (
            <section className="rounded-[28px] border border-[#FFD8C7] bg-gradient-to-br from-white to-[#FFF5E0] p-6 shadow-[0_16px_48px_rgba(255,72,0,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FF6D33]">Airbridge Report</p>
                  <h2 className="mt-2 text-3xl font-bold text-[#121417]">{linkData.campaign_name}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#6B6E75]">
                    <span>{format(new Date(linkData.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
                    <span>마트코드 {linkData.mart_code}</span>
                    <span>소재 {linkData.ad_creative}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a
                      href={linkData.short_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-[#3182CE] hover:underline"
                    >
                      {linkData.short_url}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleCopy(linkData.short_url, "short")}
                      className="inline-flex items-center gap-1 rounded-full border border-[#E0E1E3] bg-white px-3 py-1.5 text-xs hover:border-[#FF9E73] hover:bg-[#FFF5F0]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied === "short" ? "링크 복사됨" : "링크 복사"}
                    </button>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${getStatusTone(reportData.report_status)}`}>
                  {reportData.report_status}
                </span>
              </div>

              {reportData.report_message ? (
                <p className="mt-4 rounded-2xl border border-[#E0E1E3] bg-white/80 px-4 py-3 text-sm text-[#6B6E75]">
                  {reportData.report_message}
                </p>
              ) : null}

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "Clicks", value: reportData.report_metrics.clicks },
                  { label: "Impressions", value: reportData.report_metrics.impressions },
                  { label: "Installs (App)", value: reportData.report_metrics.app_installs },
                  { label: "Deeplink Opens (App)", value: reportData.report_metrics.app_deeplink_opens },
                  { label: "Opens (Web)", value: reportData.report_metrics.web_opens },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[#E0E1E3] bg-white p-6 shadow-[0_10px_24px_rgba(18,20,23,0.04)]">
                    <p className="text-sm text-[#6B6E75]">{item.label}</p>
                    <p className="mt-6 text-4xl font-bold text-[#121417]">{formatMetricNumber(item.value)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "Channel Type", value: reportData.report_dimensions.channel_type },
                  { label: "Channel", value: reportData.report_dimensions.channel },
                  { label: "Campaign", value: reportData.report_dimensions.campaign },
                  { label: "Ad Group", value: reportData.report_dimensions.ad_group },
                  { label: "Ad Creative", value: reportData.report_dimensions.ad_creative },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[#E0E1E3] bg-white p-6 shadow-[0_10px_24px_rgba(18,20,23,0.04)]">
                    <p className="text-sm text-[#6B6E75]">{item.label}</p>
                    <p className="mt-4 break-words text-2xl font-semibold text-[#121417]">
                      {item.value || "-"}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : campaign ? (
            <section className="rounded-2xl border border-dashed border-[#E0E1E3] bg-white px-4 py-10 text-center text-sm text-[#6B6E75]">
              해당 캠페인의 리포트를 불러오는 중이거나 아직 데이터가 없습니다.
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed border-[#E0E1E3] bg-white px-4 py-10 text-center text-sm text-[#6B6E75]">
              캠페인명을 입력하면 해당 링크에 대한 실시간 리포트를 전용 페이지로 확인할 수 있습니다.
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
