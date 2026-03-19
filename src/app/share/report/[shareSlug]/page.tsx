import type { Metadata } from "next";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";

import { getLinkReport } from "@/lib/linkReport";
import { getCampaignLinkMeta, getSharedReportBySlug } from "@/lib/sharedReports";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "공유 리포트",
  robots: {
    index: false,
    follow: false,
  },
};

function statusTone(status: string) {
  if (status === "SUCCESS") return "bg-[#E6F5EF] text-[#004D33]";
  if (status === "PENDING") return "bg-[#FFF5E0] text-[#CC8200]";
  return "bg-[#FDECEC] text-[#B83232]";
}

function renderMetric(label: string, value: number | null) {
  return (
    <div className="rounded-2xl border border-[#E0E1E3] bg-white px-4 py-4 shadow-[0_2px_8px_rgba(18,20,23,0.04)]">
      <p className="text-xs text-[#6B6E75]">{label}</p>
      <p className="mt-1 text-3xl font-bold text-[#121417]">{value ?? 0}</p>
    </div>
  );
}

function renderDimension(label: string, value: string | null) {
  return (
    <div className="rounded-2xl border border-[#E0E1E3] bg-white px-4 py-4 shadow-[0_2px_8px_rgba(18,20,23,0.04)]">
      <p className="text-xs text-[#6B6E75]">{label}</p>
      <p className="mt-1 break-all text-base font-semibold text-[#121417]">{value ?? "N/A"}</p>
    </div>
  );
}

type PageProps = {
  params: {
    shareSlug: string;
  };
};

export default async function SharedCampaignReportPage({ params }: PageProps) {
  try {
    const share = await getSharedReportBySlug(params.shareSlug);
    const link = await getCampaignLinkMeta(share.campaign_name);
    const report = await getLinkReport({
      shortUrl: link.short_url,
      airbridgeLinkId: link.airbridge_link_id ?? undefined,
      forceRefresh: true,
    });

    return (
      <main className="qmk-surface min-h-screen px-4 py-8 text-[#121417] sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <section className="rounded-[28px] border border-[#FFD8C7] bg-gradient-to-br from-white via-[#FFF9F5] to-[#FFF5E0] px-6 py-6 shadow-[0_18px_60px_rgba(255,72,0,0.08)] sm:px-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center rounded-full border border-[#FFD8C7] bg-[#FFF5F0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FF6D33]">
                  Shared Airbridge Report
                </div>
                <h1 className="mt-4 text-3xl font-bold text-[#121417]">
                  {share.label?.trim() || share.campaign_name}
                </h1>
                <p className="mt-2 max-w-3xl break-all text-sm leading-6 text-[#6B6E75]">
                  {link.short_url}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#6B6E75]">
                  <span>업데이트 {format(new Date(), "yyyy-MM-dd HH:mm:ss")}</span>
                  <span>생성일 {format(new Date(link.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
                  <span>마트코드 {link.mart_code}</span>
                  <span>소재 {link.ad_creative}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusTone(
                    report.report_status,
                  )}`}
                >
                  {report.report_status}
                </span>
                <a
                  href={`/share/report/${params.shareSlug}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#CC3A00]"
                >
                  <RefreshCw className="h-4 w-4" />
                  새로고침
                </a>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {renderMetric("Clicks", report.report_metrics.clicks)}
              {renderMetric("Impressions", report.report_metrics.impressions)}
              {renderMetric("Installs (App)", report.report_metrics.app_installs)}
              {renderMetric("Deeplink Opens (App)", report.report_metrics.app_deeplink_opens)}
              {renderMetric("Opens (Web)", report.report_metrics.web_opens)}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {renderDimension("Channel Type", report.report_dimensions.channel_type)}
              {renderDimension("Channel", report.report_dimensions.channel)}
              {renderDimension("Campaign", report.report_dimensions.campaign)}
              {renderDimension("Ad Group", report.report_dimensions.ad_group)}
              {renderDimension("Ad Creative", report.report_dimensions.ad_creative)}
            </div>

            {report.report_message ? (
              <div className="mt-4 rounded-2xl border border-[#FFD580] bg-[#FFF5E0] px-4 py-3 text-sm text-[#CC8200]">
                {report.report_message}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "공유 리포트를 불러오지 못했습니다.";

    return (
      <main className="qmk-surface flex min-h-screen items-center justify-center px-4 py-10 text-[#121417]">
        <section className="w-full max-w-xl rounded-[28px] border border-[#FFD8C7] bg-white px-6 py-8 text-center shadow-[0_18px_60px_rgba(255,72,0,0.08)]">
          <div className="inline-flex items-center rounded-full border border-[#FFD8C7] bg-[#FFF5F0] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FF6D33]">
            Shared Airbridge Report
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[#121417]">리포트를 열 수 없습니다</h1>
          <p className="mt-3 text-sm leading-6 text-[#6B6E75]">{message}</p>
        </section>
      </main>
    );
  }
}
