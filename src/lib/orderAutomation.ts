export type OrderAutomationRowInput = {
  mart_name?: string;
  item_type?: string;
  count?: number | string | null;
  requester?: string | null;
  filename?: string | null;
  design_type?: string | null;
  spec?: string | null;
};

export type MartLookupRow = {
  name: string;
  code: string;
};

export type ResolvedOrderTask = {
  mart_name: string;
  mart_code: string;
  item_type: string;
  ad_creative: string;
  quantity: number;
  requester: string | null;
  filename: string | null;
  design_type: string | null;
  spec: string | null;
};

export type UnresolvedOrderTask = {
  mart_name: string;
  mart_code: string | null;
  item_type: string;
  ad_creative: string | null;
  quantity: number;
  requester: string | null;
  filename: string | null;
  design_type: string | null;
  spec: string | null;
  error_message: string;
};

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\-_/]/g, "");
}

function normalizeMartName(value: string) {
  return normalizeText(value).replace(/점$/g, "");
}

export function mapItemTypeToCreative(itemType: string): string | null {
  const normalized = normalizeText(itemType);

  if (["x배너", "xbanner", "x배너거치대"].includes(normalized)) {
    return "xbanner";
  }
  if (["현수막", "banner", "배너"].includes(normalized)) {
    return "banner";
  }
  if (["전단지", "flyer"].includes(normalized)) {
    return "flyer";
  }
  if (["아크릴", "acryl", "아크릴배너"].includes(normalized)) {
    return "acryl";
  }
  if (["시트지", "sheet", "시트"].includes(normalized)) {
    return "sheet";
  }
  if (["와블러", "wobbler"].includes(normalized)) {
    return "wobbler";
  }
  if (["리플렛", "leaflet", "리플렛지", "리플랫"].includes(normalized)) {
    return "leaflet";
  }

  return null;
}

function parsePositiveInteger(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(parsed));
}

export function resolveOrderAutomationTasks(params: {
  rows: OrderAutomationRowInput[];
  marts: MartLookupRow[];
}) {
  const exactMap = new Map<string, MartLookupRow>();
  const normalizedMap = new Map<string, MartLookupRow>();

  for (const mart of params.marts) {
    exactMap.set(mart.name.trim(), mart);
    normalizedMap.set(normalizeMartName(mart.name), mart);
  }

  const resolvedMap = new Map<string, ResolvedOrderTask>();
  const unresolved: UnresolvedOrderTask[] = [];

  for (const rawRow of params.rows) {
    const martName = String(rawRow.mart_name ?? "").trim();
    const itemType = String(rawRow.item_type ?? "").trim();
    const quantity = parsePositiveInteger(rawRow.count);
    const requester = rawRow.requester?.toString().trim() || null;
    const filename = rawRow.filename?.toString().trim() || null;
    const designType = rawRow.design_type?.toString().trim() || null;
    const spec = rawRow.spec?.toString().trim() || null;

    if (!martName || !itemType) {
      unresolved.push({
        mart_name: martName || "(마트명 없음)",
        mart_code: null,
        item_type: itemType || "(품목 없음)",
        ad_creative: null,
        quantity,
        requester,
        filename,
        design_type: designType,
        spec,
        error_message: "마트명 또는 품목이 비어 있습니다.",
      });
      continue;
    }

    const mart = exactMap.get(martName) ?? normalizedMap.get(normalizeMartName(martName));
    if (!mart) {
      unresolved.push({
        mart_name: martName,
        mart_code: null,
        item_type: itemType,
        ad_creative: null,
        quantity,
        requester,
        filename,
        design_type: designType,
        spec,
        error_message: "대시보드 marts 테이블에서 일치하는 마트를 찾지 못했습니다.",
      });
      continue;
    }

    const adCreative = mapItemTypeToCreative(itemType);
    if (!adCreative) {
      unresolved.push({
        mart_name: martName,
        mart_code: mart.code,
        item_type: itemType,
        ad_creative: null,
        quantity,
        requester,
        filename,
        design_type: designType,
        spec,
        error_message: "품목을 대시보드 소재 키로 매핑하지 못했습니다.",
      });
      continue;
    }

    const key = `${mart.code}__${adCreative}`;
    const existing = resolvedMap.get(key);
    if (existing) {
      existing.quantity += quantity;
      if (!existing.filename && filename) existing.filename = filename;
      if (!existing.requester && requester) existing.requester = requester;
      if (!existing.design_type && designType) existing.design_type = designType;
      if (!existing.spec && spec) existing.spec = spec;
      continue;
    }

    resolvedMap.set(key, {
      mart_name: mart.name,
      mart_code: mart.code,
      item_type: itemType,
      ad_creative: adCreative,
      quantity,
      requester,
      filename,
      design_type: designType,
      spec,
    });
  }

  return {
    resolved: Array.from(resolvedMap.values()),
    unresolved,
  };
}
