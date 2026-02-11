-- marts schema migration for Phase 3
-- Safe to run multiple times.

create table if not exists public.marts (
  id bigserial primary key,
  name text,
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marts
  add column if not exists mart_id integer,
  add column if not exists name text,
  add column if not exists code text,
  add column if not exists address text,
  add column if not exists tel text,
  add column if not exists enabled boolean not null default false,
  add column if not exists manager_name text,
  add column if not exists manager_tel text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists marts_mart_id_key on public.marts (mart_id);
create unique index if not exists marts_code_key on public.marts (code);

create or replace function public.set_updated_at_marts()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_marts on public.marts;
create trigger trg_set_updated_at_marts
before update on public.marts
for each row
execute function public.set_updated_at_marts();
