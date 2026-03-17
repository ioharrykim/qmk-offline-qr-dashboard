import type { Metadata } from "next";

import FlyerImagesReportClient from "./FlyerImagesReportClient";

export const metadata: Metadata = {
  title: "전단 이미지 성과 리포트",
  description: "큐마켓 파트너스 flyerImage 이미지별 Airbridge 성과 대시보드",
};

export default function FlyerImagesReportPage() {
  return <FlyerImagesReportClient />;
}
