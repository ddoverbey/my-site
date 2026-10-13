-- Main site (devonoverbey.com) analytics. Run once in the Supabase SQL editor.
-- Anonymous visitors can only insert; only the admin account can read.

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  anon_id text not null check (length(anon_id) <= 64),
  event text not null check (length(event) <= 64),
  props jsonb not null default '{}' check (pg_column_size(props) <= 2048),
  created_at timestamptz not null default now()
);

create index if not exists site_events_created_at_idx on public.site_events (created_at desc);

alter table public.site_events enable row level security;

grant insert on table public.site_events to anon;
grant select on table public.site_events to authenticated;

drop policy if exists "anon can log site events" on public.site_events;
create policy "anon can log site events"
  on public.site_events
  for insert
  to anon
  with check (true);

drop policy if exists "admin can view site events" on public.site_events;
create policy "admin can view site events"
  on public.site_events
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'devonoverbey@gmail.com');

-- Tighten the Cultivate dashboard policies the same way. Anyone can create a
-- Cultivate account, so "using (true)" would let any signed-in user read events
-- and waitlist emails.
drop policy if exists "authenticated can view events" on public.cultivate_events;
drop policy if exists "authenticated users can view events" on public.cultivate_events;
drop policy if exists "admin can view cultivate events" on public.cultivate_events;
create policy "admin can view cultivate events"
  on public.cultivate_events
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'devonoverbey@gmail.com');

drop policy if exists "authenticated can view waitlist" on public.cultivate_waitlist;
drop policy if exists "authenticated users can view waitlist" on public.cultivate_waitlist;
drop policy if exists "admin can view cultivate waitlist" on public.cultivate_waitlist;
create policy "admin can view cultivate waitlist"
  on public.cultivate_waitlist
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'devonoverbey@gmail.com');

-- 12-Week Year events: same admin-only read access.
drop policy if exists "authenticated can view 12wy events" on public.twelve_week_year_events;
drop policy if exists "admin can view 12wy events" on public.twelve_week_year_events;
create policy "admin can view 12wy events"
  on public.twelve_week_year_events
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'devonoverbey@gmail.com');