create table if not exists public.twelve_week_year_events (
  id bigint generated always as identity primary key,
  anon_id text not null check (length(anon_id) <= 64),
  event text not null check (length(event) <= 64),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.twelve_week_year_events enable row level security;

grant insert on table public.twelve_week_year_events to anon;
grant usage on sequence public.twelve_week_year_events_id_seq to anon;
grant select on table public.twelve_week_year_events to authenticated;

drop policy if exists "anon can log 12wy events" on public.twelve_week_year_events;
create policy "anon can log 12wy events"
  on public.twelve_week_year_events
  for insert
  to anon
  with check (true);

drop policy if exists "authenticated can view 12wy events" on public.twelve_week_year_events;
create policy "authenticated can view 12wy events"
  on public.twelve_week_year_events
  for select
  to authenticated
  using (true);
