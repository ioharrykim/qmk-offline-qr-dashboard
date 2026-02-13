import { randomBytes } from "crypto";

import { type SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";

export const ALLOWED_CREATIVES = [
  "xbanner",
  "banner",
  "flyer",
  "acryl",
  "sheet",
  "wobbler",
  "leaflet",
] as const;

type AllowedCreative = (typeof ALLOWED_CREATIVES)[number];

export class LinkServiceError extends Error {
  code: "VALIDATION" | "AIRBRIDGE" | "DB";

  constructor(code: "VALIDATION" | "AIRBRIDGE" | "DB", message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeCreativeForCampaign(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_가-힣-]/g, "")
    .slice(0, 40);
}

function isTemplateValue(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.startsWith("__PUT_") ||
    normalized.includes("PUT_YOUR") ||
    normalized.includes("YOUR_")
  );
}

async function createAirbridgeLink(params: {
  campaignName: string;
  martCode: string;
  adCreative: string;
}) {
  const appName = process.env.AIRBRIDGE_APP_NAME;
  const apiToken = process.env.AIRBRIDGE_API_TOKEN;
  const trackingLinkToken = process.env.AIRBRIDGE_TRACKING_LINK_API_TOKEN;
  const channelName = process.env.AIRBRIDGE_CHANNEL_NAME || "offline-qr";
  const deeplinkUrl = process.env.AIRBRIDGE_DEEPLINK_URL || "qmarket://home";
  const authToken = trackingLinkToken || apiToken;
  const hasAirbridgeEnv =
    !isTemplateValue(appName) && !isTemplateValue(authToken);

  if (hasAirbridgeEnv) {
    const response = await fetch("https://api.airbridge.io/v1/tracking-links", {
      method: "POST",
      headers: {
        "Accept-Language": "ko",
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        channel: channelName,
        campaignParams: {
          campaign: params.campaignName,
          ad_group: params.martCode,
          ad_creative: params.adCreative,
        },
        isReengagement: "OFF",
        deeplinkUrl,
      }),
    });

    const payload = (await response.json()) as {
      data?: {
        trackingLink?: {
          id?: string | number;
          shortUrl?: string;
        };
      };
      detail?: string;
      title?: string;
      message?: string;
    };

    if (!response.ok) {
      throw new LinkServiceError(
        "AIRBRIDGE",
        `Airbridge create failed (${response.status}): ${payload.detail || payload.title || payload.message || "unknown error"}`,
      );
    }

    const trackingLink = payload.data?.trackingLink;
    if (!trackingLink?.shortUrl) {
      throw new LinkServiceError(
        "AIRBRIDGE",
        "Airbridge response missing trackingLink.shortUrl",
      );
    }

    return {
      shortUrl: trackingLink.shortUrl,
      airbridgeLinkId: trackingLink.id ? String(trackingLink.id) : null,
    };
  }

  const random = randomBytes(8).toString("hex").slice(0, 12);
  return {
    shortUrl: `https://qmarket.online/mock/${random}`,
    airbridgeLinkId: null as string | null,
  };
}

export type CreatedLinkData = {
  campaign_name: string;
  short_url: string;
  created_at: string;
  mart_code: string;
  ad_creative: string;
};

export async function createLinkRecord(params: {
  client: SupabaseClient;
  martCode: string;
  adCreative: string;
}): Promise<CreatedLinkData> {
  const martCode = params.martCode?.trim();
  const adCreative = params.adCreative?.trim();

  if (!martCode || !adCreative) {
    throw new LinkServiceError(
      "VALIDATION",
      "mart_code와 ad_creative는 필수입니다.",
    );
  }

  const normalizedCreative = normalizeCreativeForCampaign(adCreative);
  if (!normalizedCreative) {
    throw new LinkServiceError(
      "VALIDATION",
      "ad_creative 값이 비어있거나 형식이 올바르지 않습니다.",
    );
  }

  const campaignName = `${format(new Date(), "yyMMdd")}_${martCode}_${normalizedCreative}`;

  const airbridgeResult = await createAirbridgeLink({
    campaignName,
    martCode,
    adCreative: ALLOWED_CREATIVES.includes(normalizedCreative as AllowedCreative)
      ? normalizedCreative
      : "custom",
  });

  const { data, error } = await params.client
    .from("links")
    .insert({
      mart_code: martCode,
      ad_creative: adCreative,
      campaign_name: campaignName,
      airbridge_link_id: airbridgeResult.airbridgeLinkId,
      short_url: airbridgeResult.shortUrl,
    })
    .select("campaign_name, short_url, created_at, mart_code, ad_creative")
    .single();

  if (error) {
    throw new LinkServiceError("DB", error.message);
  }

  return data;
}
