-- TrustNav live pipeline.
-- Reads are public (the demo data is synthetic). Every write goes through
-- server-side code: the ingest Edge Function (token-checked) or the demo
-- feed functions (passcode-checked). The anon role cannot write anything.

create extension if not exists pgcrypto;

create table public.devices (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('vehicle','drone')),
  profile text not null,
  route_slug text,
  created_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('demo_feed','live_engine','receiver')),
  label text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running','finished','stopped')),
  last_offset int not null default -1,
  duration_s int,
  engine_version text,
  model_version text
);

create table public.frames (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs(id) on delete cascade,
  device_id text not null references public.devices(id),
  seq int not null,
  t timestamptz not null,
  lat double precision,
  lon double precision,
  trust real not null,
  status text not null,
  rule_risk real not null,
  ml_risk real,
  hybrid_risk real not null,
  osnma text,
  fix boolean not null default true,
  sats int,
  speed_mps real,
  heading_deg real,
  attack boolean,          -- simulator ground truth; null for real receivers
  attack_kind text,
  features jsonb,
  why jsonb,
  inserted_at timestamptz not null default now(),
  unique (run_id, device_id, seq)
);
create index frames_device_time on public.frames (device_id, t desc);
create index frames_run_seq on public.frames (run_id, seq);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  device_id text not null references public.devices(id),
  scenario text,
  severity text not null,
  status text not null,
  title text not null,
  start_seq int not null,
  end_seq int not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  min_trust real not null,
  observations int not null,
  evidence jsonb,
  updated_at timestamptz not null default now(),
  unique (run_id, device_id, start_seq)
);
create index incidents_run on public.incidents (run_id, opened_at desc);

-- secrets: only hashes are stored
create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.presenter_passcodes (
  id int primary key default 1 check (id = 1),
  passcode_hash text not null
);

-- precomputed engine output for the one-click cloud demo
create table public.demo_frames (
  device_id text not null references public.devices(id),
  offset_s int not null,
  frame jsonb not null,
  primary key (device_id, offset_s)
);
create table public.demo_incident_events (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices(id),
  offset_s int not null,
  incident jsonb not null
);
create index demo_events_offset on public.demo_incident_events (offset_s);

-- latest frame per device, for the dashboard's first paint
create view public.device_latest with (security_invoker = true) as
select distinct on (f.device_id) f.*
from public.frames f
order by f.device_id, f.t desc;

alter table public.devices enable row level security;
alter table public.runs enable row level security;
alter table public.frames enable row level security;
alter table public.incidents enable row level security;
alter table public.ingest_tokens enable row level security;
alter table public.presenter_passcodes enable row level security;
alter table public.demo_frames enable row level security;
alter table public.demo_incident_events enable row level security;

create policy "public read devices" on public.devices for select to anon, authenticated using (true);
create policy "public read runs" on public.runs for select to anon, authenticated using (true);
create policy "public read frames" on public.frames for select to anon, authenticated using (true);
create policy "public read incidents" on public.incidents for select to anon, authenticated using (true);
-- ingest_tokens, presenter_passcodes, demo_* : no policies, so no client access at all

alter publication supabase_realtime add table public.frames;
alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.runs;
