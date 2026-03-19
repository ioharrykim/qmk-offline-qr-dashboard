import CampaignReportClient from "../CampaignReportClient";
import { decodeCampaignParam } from "@/lib/campaignReport";

type PageProps = {
  params: {
    campaign: string;
  };
};

export default function CampaignReportPage({ params }: PageProps) {
  return <CampaignReportClient initialCampaign={decodeCampaignParam(params.campaign)} />;
}
