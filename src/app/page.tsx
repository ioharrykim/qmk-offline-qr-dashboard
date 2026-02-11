"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  BarChart3,
  Copy,
  Download,
  Link2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";

type Mart = {
  name: string;
  code: string;
  enabled?: boolean;
  address?: string | null;
  tel?: string | null;
  manager_name?: string | null;
  manager_tel?: string | null;
};

type LinkRow = {
  created_at: string;
  campaign_name: string;
  short_url: string;
  mart_code: string;
  ad_creative: string;
  airbridge_link_id: string | null;
};

type CreateLinkResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  data?: {
    campaign_name: string;
    short_url: string;
    created_at: string;
    mart_code: string;
    ad_creative: string;
  };
};

type SyncSummary = {
  total: number;
  upserted: number;
  skipped: number;
};

type SyncResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  summary?: SyncSummary;
};

type ClearLinksResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  summary?: {
    deleted: number;
  };
};

type MartStatsResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  data?: {
    total: number;
    enabled: number;
    disabled: number;
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

const CREATIVE_OPTIONS = [
  { value: "xbanner", label: "X배너" },
  { value: "banner", label: "현수막" },
  { value: "flyer", label: "전단지" },
  { value: "acryl", label: "아크릴" },
  { value: "sheet", label: "시트지" },
  { value: "wobbler", label: "와블러" },
  { value: "leaflet", label: "리플렛" },
] as const;

const SEARCH_DEBOUNCE_MS = 280;
const MART_PAGE_SIZE = 40;

function normalizeCreativeInput(value: string): string {
  return value.trim();
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export default function Home() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [martQuery, setMartQuery] = useState("");
  const [martOptions, setMartOptions] = useState<Mart[]>([]);
  const [selectedMart, setSelectedMart] = useState<Mart | null>(null);
  const [isMartDropdownOpen, setIsMartDropdownOpen] = useState(false);
  const [highlightedMartIndex, setHighlightedMartIndex] = useState(0);
  const [showAllMarts, setShowAllMarts] = useState(false);
  const [historyMode, setHistoryMode] = useState<"all" | "mart">("all");
  const [martHasMore, setMartHasMore] = useState(false);
  const [martOffset, setMartOffset] = useState(0);

  const [selectedCreative, setSelectedCreative] = useState<(typeof CREATIVE_OPTIONS)[number]["value"]>("xbanner");
  const [useCustomCreative, setUseCustomCreative] = useState(false);
  const [customCreative, setCustomCreative] = useState("");

  const [generatedCampaignName, setGeneratedCampaignName] = useState("");
  const [generatedShortUrl, setGeneratedShortUrl] = useState("");
  const [generatedQrDataUrl, setGeneratedQrDataUrl] = useState("");
  const [generatedQrSvg, setGeneratedQrSvg] = useState("");

  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [selectedLinkReport, setSelectedLinkReport] = useState<LinkReportResponse["data"] | null>(null);
  const [copyToast, setCopyToast] = useState("");
  const [martStats, setMartStats] = useState<{ total: number; enabled: number; disabled: number } | null>(null);

  const [isMartsLoading, setIsMartsLoading] = useState(false);
  const [isMartsLoadingMore, setIsMartsLoadingMore] = useState(false);
  const [isLinksLoading, setIsLinksLoading] = useState(false);
  const [isMartStatsLoading, setIsMartStatsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingMarts, setIsSyncingMarts] = useState(false);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [isClearingLinks, setIsClearingLinks] = useState(false);
  const [reportTargetShortUrl, setReportTargetShortUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const comboboxRef = useRef<HTMLDivElement>(null);

  const effectiveCreative = useMemo(
    () => (useCustomCreative ? normalizeCreativeInput(customCreative) : selectedCreative),
    [customCreative, selectedCreative, useCustomCreative],
  );

  const loadRecentLinks = useCallback(async (mode: "all" | "mart", martCode?: string) => {
    setIsLinksLoading(true);

    const params = new URLSearchParams({ limit: "20" });
    if (mode === "mart" && martCode) params.set("mart_code", martCode);

    const response = await fetch(`/api/links?${params.toString()}`);
    const payload = (await response.json()) as {
      success: boolean;
      data?: LinkRow[];
      message?: string;
      detail?: string;
    };

    setIsLinksLoading(false);

    if (!response.ok || !payload.success) {
      setLinks([]);
      setErrorMessage(
        `최근 이력 로드 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
      );
      return;
    }

    setLinks(payload.data ?? []);
  }, []);

  const fetchMartOptions = useCallback(async (query: string, includeDisabled: boolean, offset: number) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (includeDisabled) params.set("include_disabled", "1");
    params.set("offset", String(offset));
    params.set("limit", String(MART_PAGE_SIZE));

    const response = await fetch(`/api/marts?${params.toString()}`);
    const payload = (await response.json()) as {
      success: boolean;
      data?: Mart[];
      paging?: { has_more?: boolean };
      message?: string;
      detail?: string;
    };

    if (!response.ok || !payload.success) {
      throw new Error(
        `마트 검색 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
      );
    }

    return {
      items: (payload.data ?? []).slice(0, MART_PAGE_SIZE),
      hasMore: Boolean(payload.paging?.has_more),
    };
  }, []);

  const loadMartOptions = useCallback(async (query: string, includeDisabled: boolean) => {
    setIsMartsLoading(true);
    try {
      const result = await fetchMartOptions(query, includeDisabled, 0);
      if (!result) return;
      setErrorMessage(null);
      setMartOptions(result.items);
      setMartHasMore(result.hasMore);
      setMartOffset(result.items.length);
      setHighlightedMartIndex(0);
    } catch (error) {
      setMartOptions([]);
      setMartHasMore(false);
      setMartOffset(0);
      setErrorMessage(error instanceof Error ? error.message : "마트 검색 실패");
    } finally {
      setIsMartsLoading(false);
    }
  }, [fetchMartOptions]);

  const loadMoreMartOptions = useCallback(async () => {
    if (isMartsLoading || isMartsLoadingMore || !martHasMore) return;
    setIsMartsLoadingMore(true);
    try {
      const result = await fetchMartOptions(martQuery, showAllMarts, martOffset);
      if (!result) return;
      setMartOptions((prev) => [...prev, ...result.items]);
      setMartHasMore(result.hasMore);
      setMartOffset((prev) => prev + result.items.length);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "마트 추가 로드 실패");
    } finally {
      setIsMartsLoadingMore(false);
    }
  }, [
    fetchMartOptions,
    isMartsLoading,
    isMartsLoadingMore,
    martHasMore,
    martOffset,
    martQuery,
    showAllMarts,
  ]);

  const loadMartStats = useCallback(async () => {
    setIsMartStatsLoading(true);
    const response = await fetch("/api/marts/stats");
    const payload = (await response.json()) as MartStatsResponse;
    setIsMartStatsLoading(false);

    if (!response.ok || !payload.success || !payload.data) {
      return;
    }

    setMartStats(payload.data);
  }, []);

  const handleSyncMarts = async () => {
    setIsSyncingMarts(true);
    setErrorMessage(null);

    const response = await fetch("/api/marts/sync", { method: "POST" });
    const payload = (await response.json()) as SyncResponse;

    setIsSyncingMarts(false);

    if (!response.ok || !payload.success || !payload.summary) {
      setSyncSummary(null);
      setErrorMessage(
        `마트 동기화 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
      );
      return;
    }

    setSyncSummary(payload.summary);
    await loadMartOptions(martQuery, showAllMarts);
    await loadRecentLinks(historyMode, selectedMart?.code);
    await loadMartStats();
  };

  const handleClearLinks = async () => {
    const key = window.prompt("관리자 키를 입력하세요");
    if (!key) return;
    const confirmed = window.confirm("최근 생성 이력을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.");
    if (!confirmed) return;

    setIsClearingLinks(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/admin/clear-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const payload = (await response.json()) as ClearLinksResponse;
      if (!response.ok || !payload.success) {
        setErrorMessage(
          `이력 초기화 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
        );
        return;
      }

      setSelectedLinkReport(null);
      await loadRecentLinks(historyMode, selectedMart?.code);
      setCopyToast(`최근 생성 이력 ${payload.summary?.deleted ?? 0}건 삭제 완료`);
      window.setTimeout(() => setCopyToast(""), 1600);
    } finally {
      setIsClearingLinks(false);
    }
  };

  const handleMartSelect = (mart: Mart) => {
    setSelectedMart(mart);
    setMartQuery(`${mart.name} (${mart.code})`);
    setIsMartDropdownOpen(false);
    setHistoryMode("mart");
  };

  const handleCreateLink = async () => {
    if (!selectedMart) {
      setErrorMessage("마트를 먼저 선택해주세요.");
      return;
    }
    if (!effectiveCreative) {
      setErrorMessage("소재를 선택하거나 직접 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const response = await fetch("/api/create-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mart_code: selectedMart.code, ad_creative: effectiveCreative }),
    });

    const payload = (await response.json()) as CreateLinkResponse;

    if (!response.ok || !payload.success || !payload.data) {
      setIsSubmitting(false);
      setErrorMessage(
        `링크 생성 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
      );
      return;
    }

    const [qrDataUrl, qrSvg] = await Promise.all([
      QRCode.toDataURL(payload.data.short_url, { margin: 1, width: 320 }),
      QRCode.toString(payload.data.short_url, { type: "svg", margin: 1, width: 320 }),
    ]);

    setGeneratedCampaignName(payload.data.campaign_name);
    setGeneratedShortUrl(payload.data.short_url);
    setGeneratedQrDataUrl(qrDataUrl);
    setGeneratedQrSvg(qrSvg);

    await loadRecentLinks(historyMode, selectedMart?.code);
    setIsSubmitting(false);
  };

  const handleDownloadSvg = () => {
    if (!generatedQrSvg) return;
    const blob = new Blob([generatedQrSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${generatedCampaignName || "qrcode"}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (label: string, value: string) => {
    try {
      await copyText(value);
      setCopyToast(`${label} 복사 완료`);
      window.setTimeout(() => setCopyToast(""), 1400);
    } catch {
      setErrorMessage("클립보드 복사에 실패했습니다.");
    }
  };

  const handleLoadLinkReport = async (link: LinkRow) => {
    setIsReportLoading(true);
    setReportTargetShortUrl(link.short_url);
    setErrorMessage(null);

    try {
      let taskId: string | null = null;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const params = new URLSearchParams();
        params.set("short_url", link.short_url);
        if (link.airbridge_link_id) params.set("airbridge_link_id", link.airbridge_link_id);
        if (taskId) params.set("task_id", taskId);

        const response = await fetch(`/api/link-report?${params.toString()}`);
        const payload = (await response.json()) as LinkReportResponse;

        if (!response.ok || !payload.success || !payload.data) {
          setSelectedLinkReport(null);
          setErrorMessage(
            `링크 리포트 조회 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
          );
          return;
        }

        setSelectedLinkReport(payload.data);
        taskId = payload.data.task_id;

        if (payload.data.report_status !== "PENDING" || !taskId) {
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } finally {
      setIsReportLoading(false);
      setReportTargetShortUrl(null);
    }
  };

  const showDropdown = isMartDropdownOpen && (martQuery.trim().length > 0 || martOptions.length > 0);

  const noResultMessage = useMemo(() => {
    if (isMartsLoading) return "Loading...";
    if (martOptions.length === 0) return martQuery.trim() ? "검색 결과가 없습니다." : "표시할 마트가 없습니다.";
    return null;
  }, [isMartsLoading, martOptions.length, martQuery]);

  useEffect(() => {
    void loadRecentLinks(historyMode, selectedMart?.code);
  }, [historyMode, loadRecentLinks, selectedMart?.code]);

  useEffect(() => {
    void loadMartOptions("", showAllMarts);
  }, [loadMartOptions, showAllMarts]);

  useEffect(() => {
    void loadMartStats();
  }, [loadMartStats]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMartOptions(martQuery, showAllMarts);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [martQuery, showAllMarts, loadMartOptions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!comboboxRef.current?.contains(target)) {
        setIsMartDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <main className="qmk-surface min-h-screen text-[#121417]">
      {isSyncingMarts || isReportLoading || isClearingLinks ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center bg-black/10 p-6 sm:items-start">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E0E1E3] bg-white px-4 py-2 text-sm font-medium shadow-xl">
            <RefreshCw className="h-4 w-4 animate-spin text-[#FF4800]" />
            {isSyncingMarts
              ? "마트 데이터 동기화 중..."
              : isClearingLinks
                ? "최근 생성 이력 초기화 중..."
                : "Airbridge 리포트 불러오는 중..."}
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-[#E0E1E3] bg-white/95 p-6 shadow-[0_12px_40px_rgba(18,20,23,0.06)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FF6D33]">Qmarket Offline QR</p>
              <h1 className="mt-2 text-2xl font-bold">마트 마케팅 링크 대시보드</h1>
              <p className="mt-1 text-sm text-[#6B6E75]">QR 생성, 마트 동기화, 마트별 링크 이력과 리포트까지 한 번에 확인합니다.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isMartStatsLoading ? (
                  <div className="h-7 w-60 animate-pulse rounded-full bg-[#F4F4F5]" />
                ) : martStats ? (
                  <>
                    <span className="inline-flex items-center rounded-full border border-[#66C2A0] bg-[#E6F5EF] px-2.5 py-1 text-xs font-medium text-[#004D33]">
                      운영중 마트 {martStats.enabled}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-[#FFD580] bg-[#FFF5E0] px-2.5 py-1 text-xs font-medium text-[#CC8200]">
                      대기중 마트 {martStats.disabled}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-[#E0E1E3] bg-white px-2.5 py-1 text-xs font-medium text-[#6B6E75]">
                      전체 {martStats.total}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncMarts}
              disabled={isSyncingMarts || isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
            >
              {isSyncingMarts ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              마트 데이터 동기화
            </button>
          </div>
        </section>

        {copyToast ? (
          <section className="mt-4 rounded-xl border border-[#66C2A0] bg-[#E6F5EF] px-3 py-2 text-sm text-[#004D33]">{copyToast}</section>
        ) : null}

        {syncSummary ? (
          <section className="mt-4 rounded-xl border border-[#FFD580] bg-[#FFF5E0] px-3 py-2 text-sm text-[#CC8200]">
            동기화 완료: 총 {syncSummary.total}건, 업서트 {syncSummary.upserted}건, 스킵 {syncSummary.skipped}건
          </section>
        ) : null}
        {isSyncingMarts ? (
          <section className="mt-4 rounded-xl border border-[#FF9E73] bg-white px-3 py-2 text-sm text-[#CC3A00]">
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>시트 데이터 확인 및 업서트 진행 중입니다.</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#FFF0EB]">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#FF4800]" />
            </div>
          </section>
        ) : null}

        {errorMessage ? (
          <section className="mt-4 rounded-xl border border-[#E53E3E]/40 bg-[#FDECEC] px-3 py-2 text-sm text-[#B83232]">{errorMessage}</section>
        ) : null}

        <section className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="rounded-2xl border border-[#E0E1E3] bg-white/95 p-5 shadow-[0_8px_24px_rgba(18,20,23,0.05)] lg:col-span-3">
            <h2 className="text-lg font-semibold">링크 생성</h2>

            <div className="mt-4 space-y-4">
              <div className="relative" ref={comboboxRef}>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm font-medium text-[#2E3035]">마트 검색</label>
                  <label className="inline-flex items-center gap-2 text-xs text-[#6B6E75]">
                    <input type="checkbox" checked={showAllMarts} onChange={(e) => setShowAllMarts(e.target.checked)} />
                    전체 보기
                  </label>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A3A9]" />
                  <input
                    type="text"
                    value={martQuery}
                    onFocus={() => setIsMartDropdownOpen(true)}
                    onChange={(event) => {
                      setMartQuery(event.target.value);
                      setSelectedMart(null);
                      setIsMartDropdownOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsMartDropdownOpen(false);
                        return;
                      }
                      if (!showDropdown || martOptions.length === 0) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setHighlightedMartIndex((prev) => Math.min(prev + 1, martOptions.length - 1));
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setHighlightedMartIndex((prev) => Math.max(prev - 1, 0));
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const candidate = martOptions[highlightedMartIndex];
                        if (candidate) handleMartSelect(candidate);
                      }
                    }}
                    placeholder="마트명을 입력하세요"
                    className="w-full rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] py-2 pl-10 pr-3 text-sm outline-none focus:border-[#FF6D33]"
                  />
                </div>

                {showDropdown ? (
                  <div
                    className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[#E0E1E3] bg-white shadow-lg"
                    onScroll={(event) => {
                      const target = event.currentTarget;
                      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 24) {
                        void loadMoreMartOptions();
                      }
                    }}
                  >
                    {noResultMessage ? (
                      <p className="px-3 py-2 text-sm text-[#6B6E75]">{noResultMessage}</p>
                    ) : (
                      <>
                        {martOptions.map((mart, index) => (
                          <button
                            type="button"
                            key={`${mart.code}-${index}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleMartSelect(mart);
                            }}
                            className={`block w-full px-3 py-2 text-left text-sm ${
                              index === highlightedMartIndex ? "bg-[#FFF0EB]" : "hover:bg-[#F4F4F5]"
                            }`}
                          >
                            <span className="font-medium">{mart.name}</span>
                            <span className="ml-2 text-xs text-[#6B6E75]">({mart.code})</span>
                          </button>
                        ))}
                        {isMartsLoadingMore ? (
                          <div className="px-3 py-2 text-xs text-[#6B6E75]">추가 로딩 중...</div>
                        ) : martHasMore ? (
                          <button
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              void loadMoreMartOptions();
                            }}
                            className="w-full px-3 py-2 text-left text-xs text-[#CC3A00] hover:bg-[#FFF0EB]"
                          >
                            더 불러오기
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              {selectedMart ? (
                <div className="rounded-2xl border border-[#FFD580] bg-gradient-to-br from-[#FFF5E0] to-[#FFF0EB] p-4 text-sm shadow-[0_8px_24px_rgba(255,72,0,0.08)]">
                  <p className="font-semibold text-[#CC3A00]">선택 마트 마케팅 정보</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      { label: "마트명", value: selectedMart.name || "-" },
                      { label: "코드", value: selectedMart.code || "-" },
                      { label: "대표전화", value: selectedMart.tel || "-" },
                      { label: "담당자", value: selectedMart.manager_name || "-" },
                      { label: "담당자 연락처", value: selectedMart.manager_tel || "-" },
                      { label: "주소", value: selectedMart.address || "-", full: true },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className={`rounded-xl border border-[#E0E1E3] bg-white p-3 ${
                          item.full ? "sm:col-span-2" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-[#6B6E75]">{item.label}</p>
                          <button
                            type="button"
                            disabled={item.value === "-"}
                            onClick={() => void handleCopy(item.label, item.value)}
                            className="inline-flex items-center gap-1 text-xs text-[#CC3A00] disabled:cursor-not-allowed disabled:text-[#A0A3A9]"
                          >
                            <Copy className="h-3.5 w-3.5" /> 복사
                          </button>
                        </div>
                        <p className="mt-1 break-all font-medium text-[#2E3035]">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-sm font-medium text-[#2E3035]">소재 선택</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CREATIVE_OPTIONS.map((creative) => {
                    const isSelected = !useCustomCreative && selectedCreative === creative.value;
                    return (
                      <button
                        type="button"
                        key={creative.value}
                        onClick={() => {
                          setUseCustomCreative(false);
                          setSelectedCreative(creative.value);
                        }}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          isSelected
                            ? "border-[#FF6D33] bg-[#FFF0EB] text-[#CC3A00]"
                            : "border-[#E0E1E3] bg-white text-[#2E3035] hover:bg-[#F4F4F5]"
                        }`}
                      >
                        {creative.label}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setUseCustomCreative(true)}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      useCustomCreative
                        ? "border-[#FF6D33] bg-[#FFF0EB] text-[#CC3A00]"
                        : "border-[#E0E1E3] bg-white text-[#2E3035] hover:bg-[#F4F4F5]"
                    }`}
                  >
                    직접 입력
                  </button>
                </div>

                {useCustomCreative ? (
                  <input
                    type="text"
                    value={customCreative}
                    onChange={(event) => setCustomCreative(event.target.value)}
                    placeholder="직접 입력 (campaign_name에 반영)"
                    className="mt-2 w-full rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] px-3 py-2 text-sm outline-none focus:border-[#FF6D33]"
                  />
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleCreateLink}
                disabled={isSubmitting || isSyncingMarts || !selectedMart || !effectiveCreative}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
              >
                {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                생성하기
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E0E1E3] bg-white/95 p-5 shadow-[0_8px_24px_rgba(18,20,23,0.05)] lg:col-span-2">
            <h2 className="text-lg font-semibold">생성 결과</h2>
            {!generatedShortUrl ? (
              <p className="mt-4 text-sm text-[#6B6E75]">아직 생성된 링크가 없습니다.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[#6B6E75]">campaign_name</p>
                    <button type="button" onClick={() => void handleCopy("campaign_name", generatedCampaignName)} className="inline-flex items-center gap-1 text-xs text-[#CC3A00]">
                      <Copy className="h-3.5 w-3.5" /> 복사
                    </button>
                  </div>
                  <p className="font-medium">{generatedCampaignName}</p>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[#6B6E75]">short_url</p>
                    <button type="button" onClick={() => void handleCopy("short_url", generatedShortUrl)} className="inline-flex items-center gap-1 text-xs text-[#CC3A00]">
                      <Copy className="h-3.5 w-3.5" /> 복사
                    </button>
                  </div>
                  <p className="break-all text-[#2E3035]">{generatedShortUrl}</p>
                </div>

                {generatedQrDataUrl ? (
                  <div className="space-y-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={generatedQrDataUrl} alt="QR Code" className="h-56 w-56 rounded-xl border border-[#E0E1E3] bg-white p-2" />
                    <div className="flex flex-wrap gap-2">
                      <a href={generatedQrDataUrl} download={`${generatedCampaignName || "qrcode"}.png`} className="inline-flex items-center gap-2 rounded-lg bg-[#00724C] px-3 py-2 text-sm font-medium text-white hover:bg-[#004D33]">
                        <Download className="h-4 w-4" /> PNG 다운로드
                      </a>
                      <button type="button" onClick={handleDownloadSvg} className="inline-flex items-center gap-2 rounded-lg bg-[#FFA300] px-3 py-2 text-sm font-medium text-[#121417] hover:bg-[#CC8200] hover:text-white">
                        <Download className="h-4 w-4" /> SVG 다운로드
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#E0E1E3] bg-white/95 p-5 shadow-[0_8px_24px_rgba(18,20,23,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">최근 생성 이력</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearLinks}
                disabled={isClearingLinks || isLinksLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E53E3E]/40 bg-white px-2.5 py-1.5 text-xs text-[#B83232] hover:bg-[#FDECEC] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isClearingLinks ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                이력 초기화
              </button>
              <div className="inline-flex rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] p-1 text-sm">
                <button type="button" onClick={() => setHistoryMode("all")} className={`rounded-lg px-3 py-1.5 ${historyMode === "all" ? "bg-white text-[#121417]" : "text-[#6B6E75]"}`}>전체</button>
                <button type="button" onClick={() => setHistoryMode("mart")} disabled={!selectedMart} className={`rounded-lg px-3 py-1.5 ${historyMode === "mart" ? "bg-white text-[#121417]" : "text-[#6B6E75]"} disabled:opacity-40`}>선택 마트</button>
              </div>
            </div>
          </div>

          {isLinksLoading ? (
            <p className="mt-4 text-sm text-[#6B6E75]">Loading...</p>
          ) : links.length === 0 ? (
            <p className="mt-4 text-sm text-[#6B6E75]">조건에 맞는 이력이 없습니다.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E0E1E3] text-left text-[#6B6E75]">
                    <th className="px-2 py-2">생성시각</th>
                    <th className="px-2 py-2">마트코드</th>
                    <th className="px-2 py-2">캠페인명</th>
                    <th className="px-2 py-2">링크</th>
                    <th className="px-2 py-2">리포트</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link, index) => (
                    <tr key={`${link.campaign_name}-${index}`} className="border-b border-[#F1F1F2] hover:bg-[#FFF0EB]/60">
                      <td className="px-2 py-2 text-[#6B6E75]">{format(new Date(link.created_at), "yyyy-MM-dd HH:mm:ss")}</td>
                      <td className="px-2 py-2">{link.mart_code}</td>
                      <td className="px-2 py-2 font-medium">{link.campaign_name}</td>
                      <td className="px-2 py-2"><a href={link.short_url} target="_blank" rel="noreferrer" className="text-[#3182CE] hover:underline">{link.short_url}</a></td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => handleLoadLinkReport(link)}
                          disabled={isReportLoading}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E0E1E3] bg-white px-2.5 py-1.5 text-xs hover:-translate-y-[1px] hover:border-[#FF9E73] hover:bg-[#FFF0EB] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isReportLoading && reportTargetShortUrl === link.short_url ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <BarChart3 className="h-3.5 w-3.5" />
                          )}
                          {isReportLoading && reportTargetShortUrl === link.short_url ? "조회 중..." : "리포트 보기"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-[#E0E1E3] bg-gradient-to-br from-[#FFFFFF] to-[#FFF5E0] p-4 shadow-[0_10px_30px_rgba(255,72,0,0.08)]">
            <h3 className="text-base font-semibold">선택 링크 리포트 (Airbridge)</h3>
            {isReportLoading ? (
              <div className="mt-3 space-y-3">
                <div className="h-12 animate-pulse rounded-xl bg-[#F4F4F5]" />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-[#F4F4F5]" />
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-16 animate-pulse rounded-xl bg-[#F4F4F5]" />
                  ))}
                </div>
              </div>
            ) : !selectedLinkReport ? (
              <p className="mt-2 text-sm text-[#6B6E75]">이력에서 [리포트 보기]를 클릭하세요.</p>
            ) : (
              <div className="mt-3 space-y-4 text-sm">
                <div className="rounded-xl border border-[#E0E1E3] bg-white/90 p-3">
                  <p className="text-xs uppercase tracking-wide text-[#6B6E75]">Short URL</p>
                  <p className="mt-1 break-all font-medium text-[#2E3035]">{selectedLinkReport.tracking_link.short_url}</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    { label: "Clicks", value: selectedLinkReport.report_metrics.clicks },
                    { label: "Impressions", value: selectedLinkReport.report_metrics.impressions },
                    { label: "Installs (App)", value: selectedLinkReport.report_metrics.app_installs },
                    { label: "Deeplink Opens (App)", value: selectedLinkReport.report_metrics.app_deeplink_opens },
                    { label: "Opens (Web)", value: selectedLinkReport.report_metrics.web_opens },
                  ].map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-[#E0E1E3] bg-white px-3 py-2 shadow-[0_2px_8px_rgba(18,20,23,0.04)]">
                      <p className="text-[11px] text-[#6B6E75]">{metric.label}</p>
                      <p className="mt-1 text-lg font-bold text-[#121417]">{metric.value ?? "N/A"}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Channel Type</p>
                    <p className="mt-1 font-medium">{selectedLinkReport.report_dimensions.channel_type ?? "N/A"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Channel</p>
                    <p className="mt-1 font-medium">{selectedLinkReport.report_dimensions.channel ?? "N/A"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Campaign</p>
                    <p className="mt-1 break-all font-medium">{selectedLinkReport.report_dimensions.campaign ?? "N/A"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Ad Group</p>
                    <p className="mt-1 break-all font-medium">{selectedLinkReport.report_dimensions.ad_group ?? "N/A"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Ad Creative</p>
                    <p className="mt-1 font-medium">{selectedLinkReport.report_dimensions.ad_creative ?? "N/A"}</p>
                  </div>
                  <div className="rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs text-[#6B6E75]">Status</p>
                    <p className={`mt-1 font-semibold ${
                      selectedLinkReport.report_status === "SUCCESS"
                        ? "text-[#00724C]"
                        : selectedLinkReport.report_status === "PENDING"
                          ? "text-[#CC8200]"
                          : "text-[#B83232]"
                    }`}
                    >
                      {selectedLinkReport.report_status}
                    </p>
                  </div>
                </div>
                {selectedLinkReport.report_message ? <p className="text-xs text-[#CC8200]">{selectedLinkReport.report_message}</p> : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
