-- Airbridge 링크 리포트 캐시 테이블
-- 목적: /api/link-report 응답 캐시로 재조회 속도 개선

create table if not exists public.link_report_cache (
  short_url text primary key,
  report_status text not null,
  data jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_link_report_cache_expires_at
  on public.link_report_cache (expires_at);

alter table public.link_report_cache enable row level security;

-- 서비스 롤 키로 접근 시 정책 불필요.
-- anon fallback 환경도 고려해 최소 권한 정책 추가(원치 않으면 삭제 가능).
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'link_report_cache'
      and policyname = 'link_report_cache_select_anon'
  ) then
    create policy "link_report_cache_select_anon"
      on public.link_report_cache
      for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'link_report_cache'
      and policyname = 'link_report_cache_upsert_anon'
  ) then
    create policy "link_report_cache_upsert_anon"
      on public.link_report_cache
      for insert
      to anon
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'link_report_cache'
      and policyname = 'link_report_cache_update_anon'
  ) then
    create policy "link_report_cache_update_anon"
      on public.link_report_cache
      for update
      to anon
      using (true)
      with check (true);
  end if;
end $$;
