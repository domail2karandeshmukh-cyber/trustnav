-- TrustNav Phone: a phone's own GNSS fixes, posted by the /phone page through
-- the ingest function and pulled by the engine on a laptop, which scores them
-- and posts frames like any receiver. Raw rows are never readable by the
-- browser: row-level security is on with no policy, so only the service role
-- (the edge function) touches this table.

create table public.phone_observations (
  id bigint generated always as identity primary key,
  device_id text not null,
  t timestamptz not null,
  lat double precision,
  lon double precision,
  alt_m double precision,
  speed_mps double precision,
  heading_deg double precision,
  accuracy_m double precision,
  overlay text,                      -- none | teleport | drift | jam, chosen on the phone
  inserted_at timestamptz not null default now()
);
create index phone_obs_device_id on public.phone_observations (device_id, id);
alter table public.phone_observations enable row level security;

-- the daily prune also drops phone fixes older than 3 days
create or replace function public.prune_old_frames()
returns void language sql security definer set search_path = public as $$
  delete from runs where started_at < now() - interval '3 days';
  delete from phone_observations where inserted_at < now() - interval '3 days';
$$;
revoke all on function public.prune_old_frames() from public, anon, authenticated;
