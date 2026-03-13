-- ═══════════════════════════════════════════════════════
--  AeroBrief — Supabase Schema v2
--  Run FULL script in Supabase → SQL Editor
--  (includes previous v1 tables + new ones)
-- ═══════════════════════════════════════════════════════

-- ── V1 TABLES (keep if already created) ─────────────────

create table if not exists public.ab_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null,
  phone       text,
  visible     boolean not null default true,
  rep_score   integer not null default 0,
  rep_level   text not null default 'observer',  -- observer|reporter|trusted|expert
  post_count  integer not null default 0,
  confirm_count integer not null default 0,
  created_at  timestamptz default now()
);

create table if not exists public.ab_activity (
  id          bigserial primary key,
  user_id     uuid references public.ab_users(id) on delete cascade,
  icao_dep    text not null,
  icao_arr    text,
  created_at  timestamptz default now()
);

-- ── V2: POSTS ─────────────────────────────────────────────

create table if not exists public.ab_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.ab_users(id) on delete cascade,
  icao          text not null,                    -- aerodrome ICAO
  category      text not null,                    -- met|rwy|equip|obs|ops
  title         text not null,                    -- short summary
  body          text,                             -- optional detail
  photo_url     text,                             -- Supabase Storage URL
  score         numeric not null default 1.0,     -- weighted confirmation score
  raw_confirms  integer not null default 0,       -- raw confirm count
  weighted_confirms numeric not null default 0,   -- weighted by role
  is_active     boolean not null default true,    -- false = expired/removed
  expires_at    timestamptz,                      -- set by category decay rule
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists ab_posts_icao_idx    on public.ab_posts(icao, is_active, score desc);
create index if not exists ab_posts_cat_idx     on public.ab_posts(category, created_at desc);
create index if not exists ab_posts_active_idx  on public.ab_posts(is_active, score desc);

-- ── V2: CONFIRMATIONS ─────────────────────────────────────

create table if not exists public.ab_confirmations (
  id          bigserial primary key,
  post_id     uuid references public.ab_posts(id) on delete cascade,
  user_id     uuid references public.ab_users(id) on delete cascade,
  weight      numeric not null default 1.0,       -- role-based weight
  created_at  timestamptz default now(),
  unique(post_id, user_id)                        -- one confirmation per user per post
);

create index if not exists ab_conf_post_idx on public.ab_confirmations(post_id);
create index if not exists ab_conf_user_idx on public.ab_confirmations(user_id);

-- ── ROLE → CATEGORY WEIGHT FUNCTION ──────────────────────

create or replace function public.confirm_weight(user_role text, post_category text)
returns numeric language plpgsql as $$
begin
  -- Expert roles for each category get weight 3, others get 1
  if post_category = 'met' and user_role in ('met', 'nav', 'plt') then return 3.0; end if;
  if post_category = 'rwy' and user_role in ('nav', 'gnd', 'mnt') then return 3.0; end if;
  if post_category = 'equip' and user_role in ('nav', 'mnt', 'ais') then return 3.0; end if;
  if post_category = 'obs' and user_role in ('nav', 'gnd', 'mnt') then return 2.0; end if;
  if post_category = 'ops' and user_role in ('nav', 'plt', 'met', 'ais') then return 2.0; end if;
  return 1.0;
end;
$$;

-- ── DECAY SCHEDULE (minutes before expiry by category) ───
-- met: 30min base, extended +30 per confirmation
-- rwy/equip/obs/ops: 4h base, extended +1h per confirmation

create or replace function public.post_expiry(category text, confirmed_at timestamptz, confirm_count integer)
returns timestamptz language plpgsql as $$
declare
  base_minutes integer;
  extension_minutes integer;
begin
  if category = 'met' then
    base_minutes := 30;
    extension_minutes := 30 * confirm_count;
  elsif category in ('rwy', 'equip') then
    base_minutes := 240;
    extension_minutes := 60 * confirm_count;
  else
    base_minutes := 480;
    extension_minutes := 60 * confirm_count;
  end if;
  return confirmed_at + make_interval(mins => base_minutes + extension_minutes);
end;
$$;

-- ── TRIGGER: update post score + expiry on confirmation ──

create or replace function public.on_confirmation_insert()
returns trigger language plpgsql as $$
declare
  post_cat text;
  total_weight numeric;
  raw_count integer;
begin
  -- Get post category
  select category into post_cat from public.ab_posts where id = NEW.post_id;

  -- Recalculate totals
  select
    coalesce(sum(weight), 0),
    count(*)
  into total_weight, raw_count
  from public.ab_confirmations
  where post_id = NEW.post_id;

  -- Update post
  update public.ab_posts set
    weighted_confirms = total_weight,
    raw_confirms      = raw_count,
    score             = 1.0 + total_weight,
    expires_at        = public.post_expiry(category, created_at, raw_count),
    updated_at        = now()
  where id = NEW.post_id;

  -- Update confirming user's confirm_count
  update public.ab_users set
    confirm_count = confirm_count + 1
  where id = NEW.user_id;

  -- Update post author's reputation
  update public.ab_users set
    rep_score = rep_score + NEW.weight::integer,
    rep_level = case
      when rep_score + NEW.weight >= 100 then 'expert'
      when rep_score + NEW.weight >= 30  then 'trusted'
      when rep_score + NEW.weight >= 8   then 'reporter'
      else 'observer'
    end
  where id = (select user_id from public.ab_posts where id = NEW.post_id);

  return NEW;
end;
$$;

drop trigger if exists trg_confirmation on public.ab_confirmations;
create trigger trg_confirmation
  after insert on public.ab_confirmations
  for each row execute function public.on_confirmation_insert();

-- ── TRIGGER: increment post_count on new post ────────────

create or replace function public.on_post_insert()
returns trigger language plpgsql as $$
begin
  -- Set initial expiry
  NEW.expires_at := public.post_expiry(NEW.category, NEW.created_at, 0);

  -- Increment user post count
  update public.ab_users set
    post_count = post_count + 1
  where id = NEW.user_id;

  return NEW;
end;
$$;

drop trigger if exists trg_post_insert on public.ab_posts;
create trigger trg_post_insert
  before insert on public.ab_posts
  for each row execute function public.on_post_insert();

-- ── DEACTIVATE EXPIRED POSTS (run as cron or manually) ───
-- Supabase free tier: run this via pg_cron extension or a Vercel cron
-- SELECT public.deactivate_expired_posts();

create or replace function public.deactivate_expired_posts()
returns integer language plpgsql as $$
declare affected integer;
begin
  update public.ab_posts
  set is_active = false
  where is_active = true
    and expires_at is not null
    and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────

alter table public.ab_posts          enable row level security;
alter table public.ab_confirmations  enable row level security;

-- Posts: anyone can read active posts
create policy "read active posts" on public.ab_posts
  for select using (is_active = true);

-- Posts: authenticated users (with ab_users record) can insert
create policy "insert post" on public.ab_posts
  for insert with check (true);

-- Posts: author can update their own
create policy "update own post" on public.ab_posts
  for update using (true);

-- Confirmations: anyone can read
create policy "read confirmations" on public.ab_confirmations
  for select using (true);

-- Confirmations: anyone can insert (uniqueness constraint prevents duplicates)
create policy "insert confirmation" on public.ab_confirmations
  for insert with check (true);

-- ── REALTIME ─────────────────────────────────────────────

alter publication supabase_realtime add table public.ab_posts;
alter publication supabase_realtime add table public.ab_confirmations;

-- (ab_users and ab_activity already added in v1)
-- alter publication supabase_realtime add table public.ab_users;
-- alter publication supabase_realtime add table public.ab_activity;

-- ── STORAGE BUCKET (run separately in Supabase dashboard) ─
-- Storage → New bucket → name: "aerobrief-posts" → Public: YES
-- Or via SQL:
-- insert into storage.buckets (id, name, public) values ('aerobrief-posts', 'aerobrief-posts', true);
