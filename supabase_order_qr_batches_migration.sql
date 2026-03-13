create table if not exists public.order_qr_batches (
  id bigserial primary key,
  source text not null default 'apps-script',
  source_sheet text,
  status text not null default 'SUCCESS',
  requested_count integer not null default 0,
  created_count integer not null default 0,
  failed_count integer not null default 0,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_qr_batches_created_at
  on public.order_qr_batches (created_at desc);

create table if not exists public.order_qr_batch_items (
  id bigserial primary key,
  batch_id bigint not null references public.order_qr_batches(id) on delete cascade,
  mart_name text not null,
  mart_code text,
  item_type text not null,
  ad_creative text,
  quantity integer not null default 1,
  requester text,
  filename text,
  design_type text,
  spec text,
  campaign_name text,
  short_url text,
  status text not null default 'SUCCESS',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_qr_batch_items_batch_id
  on public.order_qr_batch_items (batch_id);

create index if not exists idx_order_qr_batch_items_created_at
  on public.order_qr_batch_items (created_at desc);

alter table if exists public.order_qr_batch_items
  add column if not exists handler text;

alter table public.order_qr_batches enable row level security;
alter table public.order_qr_batch_items enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_qr_batches'
      and policyname = 'order_qr_batches_read_all'
  ) then
    create policy order_qr_batches_read_all
      on public.order_qr_batches
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_qr_batch_items'
      and policyname = 'order_qr_batch_items_read_all'
  ) then
    create policy order_qr_batch_items_read_all
      on public.order_qr_batch_items
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;
