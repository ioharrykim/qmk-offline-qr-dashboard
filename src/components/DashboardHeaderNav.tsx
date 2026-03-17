"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Images } from "lucide-react";

const NAV_ITEMS = [
  {
    href: "/",
    label: "메인 대시보드",
    description: "QR 생성, 이력, 리포트",
    icon: LayoutDashboard,
  },
  {
    href: "/flyer-images-report",
    label: "전단 이미지 리포트",
    description: "flyerImage 성과 보기",
    icon: Images,
  },
] as const;

export default function DashboardHeaderNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-4 z-30">
      <nav className="rounded-[28px] border border-[#E0E1E3] bg-white/92 px-4 py-4 shadow-[0_16px_48px_rgba(18,20,23,0.08)] backdrop-blur-xl sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FF6D33]">
              QMARKET OFFLINE MARKETING
            </p>
            <p className="mt-1 text-sm text-[#6B6E75]">
              홈 대시보드와 전단 이미지 성과 리포트를 빠르게 오갈 수 있습니다.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "group inline-flex min-w-[220px] items-center gap-3 rounded-2xl border px-4 py-3 transition",
                    isActive
                      ? "border-[#FF9E73] bg-[#FFF5F0] text-[#121417] shadow-[0_10px_24px_rgba(255,72,0,0.08)]"
                      : "border-[#E0E1E3] bg-white text-[#121417] hover:border-[#FFD8C7] hover:bg-[#FFF9F5]",
                  ].join(" ")}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span
                    className={[
                      "inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition",
                      isActive
                        ? "border-[#FFBEA1] bg-[#FFEEE6] text-[#FF4800]"
                        : "border-[#ECECEE] bg-[#F8F8F9] text-[#6B6E75] group-hover:border-[#FFD8C7] group-hover:bg-[#FFF1EA] group-hover:text-[#FF4800]",
                    ].join(" ")}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-[#6B6E75]">{item.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
