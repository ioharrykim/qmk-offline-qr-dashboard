import { randomBytes } from "crypto";

import { format } from "date-fns";
import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

const ALLOWED_CREATIVES = [
  "xbanner",
  "banner",
  "flyer",
  "acryl",
  "sheet",
  "wobbler",
  "leaflet",
] as const;

type AllowedCreative = (typeof ALLOWED_CREATIVES)[number];

type CreateLinkBody = {
  mart_code?: string;
  ad_creative?: string;
};

function normalizeCreativeForCampaign(value: string): string {
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
  const authToken = trackingLinkToken || apiToken;
  const hasAirbridgeEnv =
    !isTemplateValue(appName) && !isTemplateValue(authToken);

  if (hasAirbridgeEnv) {
    // TODO(Phase 4): extend payload with routing/deeplink/ogTag fields as needed.
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
      throw new Error(
        `Airbridge create failed (${response.status}): ${payload.detail || payload.title || payload.message || "unknown error"}`,
      );
    }

    const trackingLink = payload.data?.trackingLink;
    if (!trackingLink?.shortUrl) {
      throw new Error("Airbridge response missing trackingLink.shortUrl");
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

export async function POST(request: Request) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    return NextResponse.json(
      { success: false, message: `Supabase env 누락: ${missingEnvKeys.join(", ")}` },
      { status: 400 },
    );
  }

  let body: CreateLinkBody;

  try {
    body = (await request.json()) as CreateLinkBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "잘못된 요청 본문입니다." },
      { status: 400 },
    );
  }

  const martCode = body.mart_code?.trim();
  const adCreative = body.ad_creative?.trim();

  if (!martCode || !adCreative) {
    return NextResponse.json(
      { success: false, message: "mart_code와 ad_creative는 필수입니다." },
      { status: 400 },
    );
  }

  const normalizedCreative = normalizeCreativeForCampaign(adCreative);
  if (!normalizedCreative) {
    return NextResponse.json(
      { success: false, message: "ad_creative 값이 비어있거나 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const campaignName = `${format(new Date(), "yyMMdd")}_${martCode}_${normalizedCreative}`;
  let shortUrl: string;
  let airbridgeLinkId: string | null;
  try {
    const airbridgeResult = await createAirbridgeLink({
      campaignName,
      martCode,
      adCreative: ALLOWED_CREATIVES.includes(normalizedCreative as AllowedCreative)
        ? normalizedCreative
        : "custom",
    });
    shortUrl = airbridgeResult.shortUrl;
    airbridgeLinkId = airbridgeResult.airbridgeLinkId;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Airbridge 링크 생성 실패",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }

  const { data, error } = await client
    .from("links")
    .insert({
      mart_code: martCode,
      ad_creative: adCreative,
      campaign_name: campaignName,
      airbridge_link_id: airbridgeLinkId,
      short_url: shortUrl,
    })
    .select("campaign_name, short_url, created_at, mart_code, ad_creative")
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, message: "링크 저장 실패", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data,
  });
}
