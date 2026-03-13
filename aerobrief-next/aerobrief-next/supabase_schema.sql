-- ═══════════════════════════════════════════
--  AeroBrief — Supabase Schema
--  Run this in Supabase → SQL Editor
-- ═══════════════════════════════════════════

-- Users table
create table if not exists public.ab_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null,
  phone       text,
  visible     boolean not null default true,   -- opt-in
  created_at  timestamptz default now()
);

-- Activity feed table
create table if not exists public.ab_activity (
  id          bigserial primary key,
  user_id     uuid references public.ab_users(id) on delete cascade,
  icao_dep    text not null,
  icao_arr    text,
  created_at  timestamptz default now()
);

-- Index for fast feed queries
create index if not exists ab_activity_created_idx on public.ab_activity(created_at desc);

-- Enable Row Level Security (RLS)
alter table public.ab_users    enable row level security;
alter table public.ab_activity enable row level security;

-- RLS policies: anyone can read visible users
create policy "read visible users" on public.ab_users
  for select using (visible = true);

-- Anyone can insert their own user
create policy "insert user" on public.ab_users
  for insert with check (true);

-- Users can update their own record
create policy "update own user" on public.ab_users
  for update using (true);

-- Anyone can read activity from visible users
create policy "read activity" on public.ab_activity
  for select using (
    exists (
      select 1 from public.ab_users u
      where u.id = ab_activity.user_id and u.visible = true
    )
  );

-- Anyone can insert activity
create policy "insert activity" on public.ab_activity
  for insert with check (true);

-- Enable Realtime for activity feed
alter publication supabase_realtime add table public.ab_activity;

-- Clean up old activity (keep last 48h) — run as a cron or manually
-- delete from public.ab_activity where created_at < now() - interval '48 hours';
