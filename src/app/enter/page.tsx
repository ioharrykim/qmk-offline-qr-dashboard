"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, LogIn } from "lucide-react";

export default function EnterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
    };

    if (!response.ok || !payload.success) {
      setIsSubmitting(false);
      setErrorMessage(payload.message ?? "입장 코드 확인에 실패했습니다.");
      return;
    }

    router.replace(nextPath);
    router.refresh();
  };

  return (
    <main className="qmk-surface flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[#E0E1E3] bg-white/95 p-7 shadow-[0_24px_60px_rgba(18,20,23,0.12)]">
        <div className="inline-flex rounded-2xl bg-[#FFF0EB] p-3 text-[#CC3A00]">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-[#121417]">접속 코드 입력</h1>
        <p className="mt-2 text-sm text-[#6B6E75]">
          팀 공유용 보호 페이지입니다. 발급받은 코드를 입력해주세요.
        </p>

        <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-[#2E3035]">
            Access Code
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="코드를 입력하세요"
              className="mt-1.5 w-full rounded-xl border border-[#E0E1E3] bg-[#F4F4F5] px-3 py-2.5 text-sm outline-none focus:border-[#FF6D33]"
              autoFocus
            />
          </label>

          {errorMessage ? (
            <p className="rounded-lg border border-[#E53E3E]/40 bg-[#FDECEC] px-3 py-2 text-sm text-[#B83232]">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || code.trim().length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF4800] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#CC3A00] disabled:cursor-not-allowed disabled:bg-[#FF9E73]"
          >
            <LogIn className="h-4 w-4" />
            {isSubmitting ? "확인 중..." : "입장하기"}
          </button>
        </form>
      </section>
    </main>
  );
}
