export type FlyerImageCampaignMeta = {
  campaign: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  accent: string;
};

export const DEFAULT_FLYER_IMAGE_CAMPAIGNS: FlyerImageCampaignMeta[] = [
  {
    campaign: "InMyHand_flyerImage_2025_02",
    title: "In My Hand",
    subtitle: "2025.02 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-iH.jpg",
    accent: "#FF8A5B",
  },
  {
    campaign: "boldBlack_flyerImage_2024_08",
    title: "Bold Black",
    subtitle: "2024.08 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-bB.jpg",
    accent: "#2E3035",
  },
  {
    campaign: "contrastBlack_flyerImage_2025_02",
    title: "Contrast Black",
    subtitle: "2025.02 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-cB.jpg",
    accent: "#4A4F57",
  },
  {
    campaign: "freshGreen_flyerImage_2024_08",
    title: "Fresh Green",
    subtitle: "2024.08 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-fG.jpg",
    accent: "#2AA876",
  },
  {
    campaign: "intenseRed_flyerImage_2024_08",
    title: "Intense Red",
    subtitle: "2024.08 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-iR.jpg",
    accent: "#D64545",
  },
  {
    campaign: "newOrange_flyerImage_2025_02",
    title: "New Orange",
    subtitle: "2025.02 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-nO.jpg",
    accent: "#FF7A00",
  },
  {
    campaign: "newPhoneScreen_flyerImage_2025_02",
    title: "New Phone Screen",
    subtitle: "2025.02 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-nP.jpg",
    accent: "#5F6FFF",
  },
  {
    campaign: "oldOrange_flyerImage_2024_08",
    title: "Old Orange",
    subtitle: "2024.08 캠페인",
    imageUrl: "https://fs.qmk.me/flyerImage-oO.jpg",
    accent: "#FF9B54",
  },
];

function parseList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function getFlyerImageCampaigns(): FlyerImageCampaignMeta[] {
  const raw = process.env.AIRBRIDGE_FLYER_IMAGE_CAMPAIGNS?.trim();
  if (!raw) return DEFAULT_FLYER_IMAGE_CAMPAIGNS;

  const order = parseList(raw);
  if (order.length === 0) return DEFAULT_FLYER_IMAGE_CAMPAIGNS;

  const byCampaign = new Map(
    DEFAULT_FLYER_IMAGE_CAMPAIGNS.map((item) => [item.campaign, item]),
  );

  return order.map((campaign, index) => {
    const existing = byCampaign.get(campaign);
    if (existing) return existing;

    return {
      campaign,
      title: campaign.replace(/_flyerImage_.+$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2"),
      subtitle: "커스텀 캠페인",
      imageUrl: null,
      accent: DEFAULT_FLYER_IMAGE_CAMPAIGNS[index % DEFAULT_FLYER_IMAGE_CAMPAIGNS.length]?.accent ?? "#FF8A5B",
    } satisfies FlyerImageCampaignMeta;
  });
}

export function getFlyerImageCampaignMap() {
  return new Map(getFlyerImageCampaigns().map((item) => [item.campaign, item]));
}
