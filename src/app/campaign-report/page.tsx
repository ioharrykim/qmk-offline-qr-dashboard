import CampaignReportClient from "./CampaignReportClient";

type PageProps = {
  searchParams?: {
    campaign?: string;
  };
};

export default function CampaignReportIndexPage({ searchParams }: PageProps) {
  const campaign = searchParams?.campaign?.trim() || "";
  return <CampaignReportClient initialCampaign={campaign || undefined} />;
}
