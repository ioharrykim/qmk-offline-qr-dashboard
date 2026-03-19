create table if not exists public.shared_reports (
  id bigserial primary key,
  share_slug text not null unique,
  campaign_name text not null unique,
  label text,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_reports_share_slug
  on public.shared_reports (share_slug);

create index if not exists idx_shared_reports_campaign_name
  on public.shared_reports (campaign_name);

create index if not exists idx_shared_reports_created_at
  on public.shared_reports (created_at desc);

alter table public.shared_reports enable row level security;
