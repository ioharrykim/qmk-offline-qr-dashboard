import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마트 마케팅 링크 대시보드",
  description: "오프라인 마케팅 QR 생성 및 리포트 대시보드",
  icons: {
    icon: "https://uploads-ssl.webflow.com/65362b593ca73a3760e9874f/66a84d5faabd572bfb74ba73_favicon.png",
    shortcut:
      "https://uploads-ssl.webflow.com/65362b593ca73a3760e9874f/66a84d5faabd572bfb74ba73_favicon.png",
    apple:
      "https://uploads-ssl.webflow.com/65362b593ca73a3760e9874f/66a84d5faabd572bfb74ba73_favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
