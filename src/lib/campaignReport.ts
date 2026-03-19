export function buildCampaignReportPath(campaignName: string) {
  return `/campaign-report/${encodeURIComponent(campaignName)}`;
}

export function decodeCampaignParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
