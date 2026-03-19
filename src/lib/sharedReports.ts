import { randomBytes } from "crypto";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

export type SharedReportRow = {
  id: number;
  share_slug: string;
  campaign_name: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
};

export type CampaignLinkMeta = {
  campaign_name: string;
  short_url: string;
  created_at: string;
  mart_code: string;
  ad_creative: string;
  airbridge_link_id: string | null;
};

function buildSlug(length = 10) {
  return randomBytes(length)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, length)
    .toLowerCase();
}

export async function getCampaignLinkMeta(campaignName: string) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    throw new Error(`Supabase env가 설정되지 않았습니다. ${missingEnvKeys.join(", ")}`);
  }

  const { data, error } = await client
    .from("links")
    .select(
      "campaign_name, short_url, created_at, mart_code, ad_creative, airbridge_link_id",
    )
    .eq("campaign_name", campaignName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`캠페인 링크 조회 실패: ${error.message}`);
  }

  if (!data) {
    throw new Error("해당 캠페인 링크를 찾을 수 없습니다.");
  }

  return data as CampaignLinkMeta;
}

export async function createOrGetSharedReport(options: {
  campaignName: string;
  label?: string | null;
  expiresAt?: string | null;
}) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    throw new Error(`Supabase env가 설정되지 않았습니다. ${missingEnvKeys.join(", ")}`);
  }

  await getCampaignLinkMeta(options.campaignName);

  const nowIso = new Date().toISOString();
  const { data: existing, error: existingError } = await client
    .from("shared_reports")
    .select("id, share_slug, campaign_name, label, is_active, expires_at, created_at")
    .eq("campaign_name", options.campaignName)
    .maybeSingle();

  if (existingError && !existingError.message.toLowerCase().includes("no rows")) {
    throw new Error(`공유 리포트 조회 실패: ${existingError.message}`);
  }

  const typedExisting = existing as SharedReportRow | null;
  if (typedExisting) {
    const isExpired = typedExisting.expires_at
      ? Date.parse(typedExisting.expires_at) <= Date.now()
      : false;

    if (typedExisting.is_active && !isExpired) {
      return typedExisting;
    }

    const { data: reactivated, error: reactivateError } = await client
      .from("shared_reports")
      .update({
        is_active: true,
        label: options.label ?? typedExisting.label,
        expires_at: options.expiresAt ?? typedExisting.expires_at,
        updated_at: nowIso,
      })
      .eq("id", typedExisting.id)
      .select("id, share_slug, campaign_name, label, is_active, expires_at, created_at")
      .single();

    if (reactivateError) {
      throw new Error(`공유 리포트 재활성화 실패: ${reactivateError.message}`);
    }

    return reactivated as SharedReportRow;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareSlug = buildSlug(12);
    const { data: inserted, error: insertError } = await client
      .from("shared_reports")
      .insert({
        share_slug: shareSlug,
        campaign_name: options.campaignName,
        label: options.label ?? null,
        expires_at: options.expiresAt ?? null,
        is_active: true,
      })
      .select("id, share_slug, campaign_name, label, is_active, expires_at, created_at")
      .single();

    if (!insertError && inserted) {
      return inserted as SharedReportRow;
    }

    if (!insertError?.message.toLowerCase().includes("duplicate")) {
      throw new Error(`공유 리포트 생성 실패: ${insertError?.message ?? "unknown error"}`);
    }
  }

  throw new Error("공유 리포트 slug 생성에 여러 번 실패했습니다.");
}

export async function getSharedReportBySlug(shareSlug: string) {
  const { client, missingEnvKeys } = getSupabaseServerClient();
  if (!client) {
    throw new Error(`Supabase env가 설정되지 않았습니다. ${missingEnvKeys.join(", ")}`);
  }

  const { data, error } = await client
    .from("shared_reports")
    .select("id, share_slug, campaign_name, label, is_active, expires_at, created_at")
    .eq("share_slug", shareSlug)
    .maybeSingle();

  if (error) {
    throw new Error(`공유 리포트 조회 실패: ${error.message}`);
  }

  const row = data as SharedReportRow | null;
  if (!row) {
    throw new Error("공유 리포트를 찾을 수 없습니다.");
  }
  if (!row.is_active) {
    throw new Error("비활성화된 공유 리포트입니다.");
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("만료된 공유 리포트입니다.");
  }

  return row;
}
