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

type LinksResponse = {
  success: boolean;
  data?: LinkRow[];
  message?: string;
  detail?: string;
  paging?: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
};

type BulkCreateResponse = {
  success: boolean;
  message?: string;
  detail?: string;
  summary?: {
    requested: number;
    created: number;
    failed: number;
  };
  errors?: Array<{
    mart_code: string;
    ad_creative: string;
    message: string;
  }>;
};

type BulkMartRow = {
  mart_code: string;
  mart_name: string | null;
  selected_creatives: string[];
  custom_creatives_input: string;
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
const HISTORY_SEARCH_DEBOUNCE_MS = 220;

function normalizeCreativeInput(value: string): string {
  return value.trim();
}

function parseTextList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function buildCreativeList(preset: string[], customInput: string) {
  return Array.from(
    new Set([
      ...preset.map((value) => normalizeCreativeInput(value)),
      ...parseTextList(customInput).map((value) => normalizeCreativeInput(value)),
    ]),
  ).filter(Boolean);
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function buildIllustratorSafeQrSvg(value: string): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const margin = 0;
  const moduleSize = qr.modules.size;
  const size = moduleSize + margin * 2;

  const path: string[] = [];
  for (let y = 0; y < moduleSize; y += 1) {
    for (let x = 0; x < moduleSize; x += 1) {
      if (qr.modules.get(x, y)) {
        const px = x + margin;
        const py = y + margin;
        path.push(`M${px} ${py}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${path.join("")}" fill="#000000"/></svg>`;
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
  const [createMode, setCreateMode] = useState<"single" | "bulk">("single");

  const [selectedCreative, setSelectedCreative] = useState<(typeof CREATIVE_OPTIONS)[number]["value"]>("xbanner");
  const [useCustomCreative, setUseCustomCreative] = useState(false);
  const [customCreative, setCustomCreative] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkMartRow[]>([]);
  const [bulkCodeInput, setBulkCodeInput] = useState("");
  const [bulkCodesPasteInput, setBulkCodesPasteInput] = useState("");
  const [bulkCommonSelectedCreatives, setBulkCommonSelectedCreatives] = useState<string[]>(["xbanner"]);
  const [bulkCommonCustomCreativesInput, setBulkCommonCustomCreativesInput] = useState("");
  const [bulkSummary, setBulkSummary] = useState<BulkCreateResponse["summary"] | null>(null);
  const [bulkErrorRows, setBulkErrorRows] = useState<BulkCreateResponse["errors"]>([]);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

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
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyCreativeFilter, setHistoryCreativeFilter] = useState("all");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyQueryDebounced, setHistoryQueryDebounced] = useState("");

  const comboboxRef = useRef<HTMLDivElement>(null);

  const effectiveCreative = useMemo(
    () => (useCustomCreative ? normalizeCreativeInput(customCreative) : selectedCreative),
    [customCreative, selectedCreative, useCustomCreative],
  );

  const bulkRequestedCount = useMemo(
    () =>
      bulkRows.reduce((sum, row) => {
        const creatives = buildCreativeList(
          row.selected_creatives,
          row.custom_creatives_input,
        );
        return sum + creatives.length;
      }, 0),
    [bulkRows],
  );

  const loadRecentLinks = useCallback(async () => {
    setIsLinksLoading(true);

    const params = new URLSearchParams({
      limit: String(historyLimit),
      offset: "0",
    });
    if (historyMode === "mart" && selectedMart?.code) params.set("mart_code", selectedMart.code);
    if (historyQueryDebounced) params.set("q", historyQueryDebounced);
    if (historyCreativeFilter !== "all") params.set("ad_creative", historyCreativeFilter);
    if (historyDateFrom) params.set("date_from", historyDateFrom);
    if (historyDateTo) params.set("date_to", historyDateTo);

    const response = await fetch(`/api/links?${params.toString()}`);
    const payload = (await response.json()) as LinksResponse;

    setIsLinksLoading(false);

    if (!response.ok || !payload.success) {
      setLinks([]);
      setErrorMessage(
        `최근 이력 로드 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
      );
      return;
    }

    setLinks(payload.data ?? []);
  }, [
    historyCreativeFilter,
    historyDateFrom,
    historyDateTo,
    historyLimit,
    historyMode,
    historyQueryDebounced,
    selectedMart?.code,
  ]);

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
    await loadRecentLinks();
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
      await loadRecentLinks();
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
      Promise.resolve(buildIllustratorSafeQrSvg(payload.data.short_url)),
    ]);

    setGeneratedCampaignName(payload.data.campaign_name);
    setGeneratedShortUrl(payload.data.short_url);
    setGeneratedQrDataUrl(qrDataUrl);
    setGeneratedQrSvg(qrSvg);

    await loadRecentLinks();
    setIsSubmitting(false);
  };

  const resolveMartNameByCode = useCallback(
    (code: string) => {
      if (selectedMart?.code === code) return selectedMart.name;
      return martOptions.find((item) => item.code === code)?.name ?? null;
    },
    [martOptions, selectedMart],
  );

  const appendBulkRows = useCallback(
    (codes: string[]) => {
      const normalizedCodes = Array.from(
        new Set(codes.map((value) => value.trim()).filter(Boolean)),
      );
      if (normalizedCodes.length === 0) return 0;

      let addedCount = 0;
      setBulkRows((prev) => {
        const existing = new Set(prev.map((row) => row.mart_code));
        const next = [...prev];
        for (const code of normalizedCodes) {
          if (existing.has(code)) continue;
          addedCount += 1;
          next.push({
            mart_code: code,
            mart_name: resolveMartNameByCode(code),
            selected_creatives: ["xbanner"],
            custom_creatives_input: "",
          });
        }
        return next;
      });
      return addedCount;
    },
    [resolveMartNameByCode],
  );

  const handleAddSelectedMartToBulk = () => {
    if (!selectedMart) {
      setErrorMessage("마트를 먼저 선택해주세요.");
      return;
    }
    const addedCount = appendBulkRows([selectedMart.code]);
    setCopyToast(
      addedCount > 0 ? `마트 추가: ${selectedMart.code}` : "이미 추가된 마트입니다.",
    );
    window.setTimeout(() => setCopyToast(""), 1200);
  };

  const handleAddBulkCodeInput = () => {
    const code = bulkCodeInput.trim();
    if (!code) return;
    const addedCount = appendBulkRows([code]);
    setBulkCodeInput("");
    if (addedCount === 0) {
      setCopyToast("이미 추가된 마트 코드입니다.");
    } else {
      setCopyToast(`마트 코드 추가: ${code}`);
    }
    window.setTimeout(() => setCopyToast(""), 1200);
  };

  const handleAddBulkCodesFromPaste = () => {
    const codes = parseTextList(bulkCodesPasteInput);
    if (codes.length === 0) {
      setErrorMessage("추가할 마트 코드가 없습니다.");
      return;
    }
    const addedCount = appendBulkRows(codes);
    setBulkCodesPasteInput("");
    setCopyToast(`${addedCount}개 마트 코드가 추가되었습니다.`);
    window.setTimeout(() => setCopyToast(""), 1200);
  };

  const toggleBulkCommonCreative = (creative: string) => {
    setBulkCommonSelectedCreatives((prev) =>
      prev.includes(creative)
        ? prev.filter((value) => value !== creative)
        : [...prev, creative],
    );
  };

  const applyCommonCreativesToAllRows = () => {
    if (bulkRows.length === 0) {
      setErrorMessage("먼저 마트를 1개 이상 추가해주세요.");
      return;
    }
    setBulkRows((prev) =>
      prev.map((row) => ({
        ...row,
        selected_creatives: [...bulkCommonSelectedCreatives],
        custom_creatives_input: bulkCommonCustomCreativesInput,
      })),
    );
    setCopyToast("공통 소재를 모든 마트에 적용했습니다.");
    window.setTimeout(() => setCopyToast(""), 1200);
  };

  const toggleRowCreative = (martCode: string, creative: string) => {
    setBulkRows((prev) =>
      prev.map((row) =>
        row.mart_code !== martCode
          ? row
          : {
              ...row,
              selected_creatives: row.selected_creatives.includes(creative)
                ? row.selected_creatives.filter((value) => value !== creative)
                : [...row.selected_creatives, creative],
            },
      ),
    );
  };

  const updateRowCustomCreatives = (martCode: string, value: string) => {
    setBulkRows((prev) =>
      prev.map((row) =>
        row.mart_code === martCode
          ? { ...row, custom_creatives_input: value }
          : row,
      ),
    );
  };

  const removeBulkRow = (martCode: string) => {
    setBulkRows((prev) => prev.filter((row) => row.mart_code !== martCode));
  };

  const handleBulkCreateLinks = async () => {
    if (bulkRows.length === 0) {
      setErrorMessage("대량 생성할 마트를 1개 이상 추가해주세요.");
      return;
    }

    const requestRows = bulkRows
      .map((row) => ({
        mart_code: row.mart_code,
        ad_creatives: buildCreativeList(
          row.selected_creatives,
          row.custom_creatives_input,
        ),
      }))
      .filter((row) => row.ad_creatives.length > 0);

    if (requestRows.length === 0) {
      setErrorMessage("각 마트별로 최소 1개 이상의 소재를 선택해주세요.");
      return;
    }

    setIsBulkSubmitting(true);
    setErrorMessage(null);
    setBulkSummary(null);
    setBulkErrorRows([]);

    try {
      const response = await fetch("/api/create-link/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: requestRows,
        }),
      });
      const payload = (await response.json()) as BulkCreateResponse;

      if (!response.ok || !payload.summary) {
        setErrorMessage(
          `대량 링크 생성 실패: ${payload.message ?? "unknown error"}${payload.detail ? ` (${payload.detail})` : ""}`,
        );
        return;
      }

      setBulkSummary(payload.summary);
      setBulkErrorRows(payload.errors ?? []);
      await loadRecentLinks();
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleResetHistoryFilters = () => {
    setHistoryQuery("");
    setHistoryCreativeFilter("all");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setHistoryLimit(20);
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

  const handleDownloadHistoryQr = async (
    shortUrl: string,
    campaignName: string,
    formatType: "png" | "svg",
  ) => {
    try {
      if (formatType === "png") {
        const dataUrl = await QRCode.toDataURL(shortUrl, { margin: 1, width: 320 });
        const anchor = document.createElement("a");
        anchor.href = dataUrl;
        anchor.download = `${campaignName || "qrcode"}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        return;
      }

      const svg = buildIllustratorSafeQrSvg(shortUrl);
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${campaignName || "qrcode"}.svg`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("이력 QR 다운로드에 실패했습니다.");
    }
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
        if (taskId) {
          params.set("task_id", taskId);
          params.set("refresh", "1");
        }

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
    void loadRecentLinks();
  }, [loadRecentLinks]);

  useEffect(() => {
    void loadMartOptions("", showAllMarts);
  }, [loadMartOptions, showAllMarts]);

  useEffect(() => {
    void loadMartStats();
  }, [loadMartStats]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHistoryQueryDebounced(historyQuery.trim());
    }, HISTORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [historyQuery]);

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
      {isSyncingMarts || isReportLoading || isClearingLinks || isBulkSubmitting ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center bg-black/10 p-6 sm:items-start">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E0E1E3] bg-white px-4 py-2 text-sm font-medium shadow-xl">
            <RefreshCw className="h-4 w-4 animate-spin text-[#FF4800]" />
            {isSyncingMarts
              ? "마트 데이터 동기화 중..."
              : isBulkSubmitting
                ? "대량 링크 생성 중..."
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
              disabled={isSyncingMarts || isSubmitting || isBulkSubmitting}
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
                      if (historyMode === "mart") {
                        setHistoryMode("all");
                      }
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

              <div className="inline-flex rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setCreateMode("single")}
                  className={`rounded-lg px-3 py-1.5 ${
                    createMode === "single"
                      ? "bg-white font-semibold text-[#121417]"
                      : "text-[#6B6E75]"
                  }`}
                >
                  단건 생성
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("bulk")}
                  className={`rounded-lg px-3 py-1.5 ${
                    createMode === "bulk"
                      ? "bg-[#FF4800] font-semibold text-white"
                      : "text-[#6B6E75]"
                  }`}
                >
                  대량 생성
                </button>
              </div>

              {createMode === "single" ? (
                <>
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
                    disabled={isSubmitting || isSyncingMarts || isBulkSubmitting || !selectedMart || !effectiveCreative}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
                  >
                    {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    생성하기
                  </button>
                </>
              ) : (
                <div className="space-y-4 rounded-xl border border-[#FF9E73] bg-gradient-to-b from-[#FFF7F3] to-[#FFFFFF] p-4">
                  <div className="rounded-lg border border-[#FFD8C7] bg-[#FFF0EB] px-3 py-2">
                    <p className="text-sm font-semibold text-[#CC3A00]">대량 생성 가이드</p>
                    <p className="mt-1 text-xs text-[#6B6E75]">
                      1) 마트 추가 → 2) 소재 일괄 설정(선택) → 3) 마트별 소재 조정 → 4) 대량 생성
                    </p>
                  </div>

                  <section className="space-y-2 rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs font-semibold text-[#CC3A00]">STEP 1. 마트 추가</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddSelectedMartToBulk}
                        disabled={!selectedMart}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#FF4800] px-3 py-2 text-xs font-semibold text-white hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
                      >
                        선택 마트 추가
                      </button>
                      <span className="text-xs text-[#6B6E75]">
                        {selectedMart ? `${selectedMart.name} (${selectedMart.code})` : "먼저 마트를 검색해 선택하세요"}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        type="text"
                        value={bulkCodeInput}
                        onChange={(event) => setBulkCodeInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleAddBulkCodeInput();
                          }
                        }}
                        placeholder="마트 코드 직접 입력 (예: naiseumart_yeongyeong)"
                        className="w-full rounded-xl border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-2 text-sm outline-none focus:border-[#FF6D33]"
                      />
                      <button
                        type="button"
                        onClick={handleAddBulkCodeInput}
                        className="rounded-xl bg-[#FF6D33] px-3 py-2 text-sm font-medium text-white hover:bg-[#CC3A00]"
                      >
                        코드 추가
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <textarea
                        value={bulkCodesPasteInput}
                        onChange={(event) => setBulkCodesPasteInput(event.target.value)}
                        placeholder="마트 코드 일괄 붙여넣기 (쉼표/줄바꿈 구분)"
                        rows={3}
                        className="w-full rounded-xl border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-2 text-sm outline-none focus:border-[#FF6D33]"
                      />
                      <button
                        type="button"
                        onClick={handleAddBulkCodesFromPaste}
                        className="rounded-xl bg-[#FF6D33] px-3 py-2 text-sm font-medium text-white hover:bg-[#CC3A00]"
                      >
                        목록으로 추가
                      </button>
                    </div>
                  </section>

                  <section className="space-y-2 rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs font-semibold text-[#CC3A00]">STEP 2. 공통 소재 일괄 설정 (선택)</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {CREATIVE_OPTIONS.map((creative) => {
                        const isChecked = bulkCommonSelectedCreatives.includes(creative.value);
                        return (
                          <button
                            type="button"
                            key={`bulk-common-${creative.value}`}
                            onClick={() => toggleBulkCommonCreative(creative.value)}
                            className={`rounded-lg border px-2 py-2 text-xs ${
                              isChecked
                                ? "border-[#FF6D33] bg-[#FFF0EB] text-[#CC3A00]"
                                : "border-[#E0E1E3] bg-white text-[#2E3035]"
                            }`}
                          >
                            {creative.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        type="text"
                        value={bulkCommonCustomCreativesInput}
                        onChange={(event) => setBulkCommonCustomCreativesInput(event.target.value)}
                        placeholder="추가 소재 직접 입력 (쉼표 구분)"
                        className="w-full rounded-xl border border-[#E0E1E3] bg-[#F8F8F9] px-3 py-2 text-sm outline-none focus:border-[#FF6D33]"
                      />
                      <button
                        type="button"
                        onClick={applyCommonCreativesToAllRows}
                        className="rounded-xl bg-[#FFA300] px-3 py-2 text-sm font-medium text-[#121417] hover:bg-[#CC8200] hover:text-white"
                      >
                        전체 적용
                      </button>
                    </div>
                  </section>

                  <section className="space-y-2 rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[#CC3A00]">STEP 3. 마트별 소재 개별 설정</p>
                      <span className="rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[11px] text-[#6B6E75]">
                        선택 마트 {bulkRows.length}개
                      </span>
                    </div>
                    {bulkRows.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-[#E0E1E3] bg-[#F8F8F9] px-3 py-4 text-center text-xs text-[#6B6E75]">
                        STEP 1에서 마트를 먼저 추가하세요.
                      </p>
                    ) : (
                      <div className="max-h-80 space-y-2 overflow-auto rounded-xl border border-[#E0E1E3] bg-[#F8F8F9] p-3">
                        {bulkRows.map((row) => {
                          const rowCreatives = buildCreativeList(
                            row.selected_creatives,
                            row.custom_creatives_input,
                          );
                          return (
                            <div key={row.mart_code} className="rounded-lg border border-[#E0E1E3] bg-white p-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-[#2E3035]">
                                  {row.mart_name ? `${row.mart_name} (${row.mart_code})` : row.mart_code}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => removeBulkRow(row.mart_code)}
                                  className="text-xs text-[#B83232] hover:underline"
                                >
                                  제거
                                </button>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                                {CREATIVE_OPTIONS.map((creative) => {
                                  const isChecked = row.selected_creatives.includes(creative.value);
                                  return (
                                    <button
                                      type="button"
                                      key={`${row.mart_code}-${creative.value}`}
                                      onClick={() => toggleRowCreative(row.mart_code, creative.value)}
                                      className={`rounded-lg border px-2 py-1.5 text-[11px] ${
                                        isChecked
                                          ? "border-[#FF6D33] bg-[#FFF0EB] text-[#CC3A00]"
                                          : "border-[#E0E1E3] bg-white text-[#2E3035]"
                                      }`}
                                    >
                                      {creative.label}
                                    </button>
                                  );
                                })}
                              </div>
                              <input
                                type="text"
                                value={row.custom_creatives_input}
                                onChange={(event) =>
                                  updateRowCustomCreatives(row.mart_code, event.target.value)
                                }
                                placeholder="이 마트 전용 추가 소재 (쉼표 구분)"
                                className="mt-2 w-full rounded-lg border border-[#E0E1E3] bg-[#F8F8F9] px-2 py-1.5 text-xs outline-none focus:border-[#FF6D33]"
                              />
                              <p className="mt-1 text-[11px] text-[#6B6E75]">
                                생성 소재: {rowCreatives.length > 0 ? rowCreatives.join(", ") : "선택 없음"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-2 rounded-xl border border-[#E0E1E3] bg-white p-3">
                    <p className="text-xs font-semibold text-[#CC3A00]">STEP 4. 실행</p>
                    <p className="text-xs text-[#6B6E75]">
                      예상 생성 건수:{" "}
                      <span className="font-semibold text-[#CC3A00]">{bulkRequestedCount}</span>
                    </p>

                  <button
                    type="button"
                    onClick={handleBulkCreateLinks}
                    disabled={isBulkSubmitting || isSubmitting || isSyncingMarts}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
                  >
                    {isBulkSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                    대량 링크 생성
                  </button>
                  </section>

                  {bulkSummary ? (
                    <div className="rounded-lg border border-[#E0E1E3] bg-white px-3 py-2 text-xs text-[#2E3035]">
                      요청 {bulkSummary.requested}건 / 성공 {bulkSummary.created}건 / 실패 {bulkSummary.failed}건
                    </div>
                  ) : null}
                  {bulkErrorRows && bulkErrorRows.length > 0 ? (
                    <div className="max-h-24 overflow-auto rounded-lg border border-[#E53E3E]/30 bg-[#FDECEC] px-3 py-2 text-xs text-[#B83232]">
                      {bulkErrorRows.slice(0, 20).map((row, index) => (
                        <p key={`${row.mart_code}-${row.ad_creative}-${index}`}>
                          {row.mart_code} / {row.ad_creative}: {row.message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
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

          <div className="mt-3 grid gap-2 rounded-xl border border-[#E0E1E3] bg-[#F8F8F9] p-3 sm:grid-cols-2 lg:grid-cols-6">
            <input
              type="text"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="캠페인명/링크/마트코드 검색"
              className="rounded-lg border border-[#E0E1E3] bg-white px-3 py-2 text-sm outline-none focus:border-[#FF6D33] sm:col-span-2"
            />
            <select
              value={historyCreativeFilter}
              onChange={(event) => setHistoryCreativeFilter(event.target.value)}
              className="rounded-lg border border-[#E0E1E3] bg-white px-2 py-2 text-sm outline-none focus:border-[#FF6D33]"
            >
              <option value="all">소재 전체</option>
              {CREATIVE_OPTIONS.map((creative) => (
                <option key={`filter-${creative.value}`} value={creative.value}>
                  {creative.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={historyDateFrom}
              onChange={(event) => setHistoryDateFrom(event.target.value)}
              className="rounded-lg border border-[#E0E1E3] bg-white px-2 py-2 text-sm outline-none focus:border-[#FF6D33]"
            />
            <input
              type="date"
              value={historyDateTo}
              onChange={(event) => setHistoryDateTo(event.target.value)}
              className="rounded-lg border border-[#E0E1E3] bg-white px-2 py-2 text-sm outline-none focus:border-[#FF6D33]"
            />
            <div className="flex items-center gap-2">
              <select
                value={historyLimit}
                onChange={(event) => setHistoryLimit(Number(event.target.value))}
                className="w-full rounded-lg border border-[#E0E1E3] bg-white px-2 py-2 text-sm outline-none focus:border-[#FF6D33]"
              >
                <option value={20}>20개</option>
                <option value={50}>50개</option>
                <option value={100}>100개</option>
              </select>
              <button
                type="button"
                onClick={handleResetHistoryFilters}
                className="rounded-lg border border-[#E0E1E3] bg-white px-2 py-2 text-xs text-[#6B6E75] hover:bg-[#F4F4F5]"
              >
                초기화
              </button>
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
                    <th className="px-2 py-2">QR</th>
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDownloadHistoryQr(link.short_url, link.campaign_name, "png")}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#E0E1E3] bg-white px-2 py-1.5 text-xs hover:border-[#66C2A0] hover:bg-[#E6F5EF]"
                          >
                            <Download className="h-3.5 w-3.5" /> PNG
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownloadHistoryQr(link.short_url, link.campaign_name, "svg")}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#E0E1E3] bg-white px-2 py-1.5 text-xs hover:border-[#FFD580] hover:bg-[#FFF5E0]"
                          >
                            <Download className="h-3.5 w-3.5" /> SVG
                          </button>
                        </div>
                      </td>
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
