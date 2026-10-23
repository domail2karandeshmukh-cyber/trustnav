-- 1. Brute-force limit on the presenter passcode.
-- The passcode functions are intentionally callable by anon (the dashboard's
-- presenter controls). After 10 wrong passcodes in 10 minutes, every attempt
-- is refused until the window cools down.
create table if not exists public.presenter_failures (at timestamptz not null default now());
alter table public.presenter_failures enable row level security;

create or replace function public._presenter_ok(passcode text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare ok boolean;
begin
  if (select count(*) from presenter_failures where at > now() - interval '10 minutes') >= 10 then
    raise exception 'too many attempts, try again in 10 minutes' using errcode = '28000';
  end if;
  select crypt(passcode, passcode_hash) = passcode_hash into ok from presenter_passcodes where id = 1;
  if not coalesce(ok, false) then
    insert into presenter_failures default values;
    delete from presenter_failures where at < now() - interval '1 day';
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public._presenter_ok(text) from public, anon, authenticated;

create or replace function public.check_presenter(passcode text)
returns boolean language plpgsql security definer set search_path = public
as $$ begin return _presenter_ok(passcode); end; $$;

create or replace function public.stop_demo_feed(passcode text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not _presenter_ok(passcode) then raise exception 'invalid passcode' using errcode = '28000'; end if;
  update runs set status = 'stopped', ended_at = now() where status = 'running' and mode = 'demo_feed';
end;
$$;

create or replace function public.start_demo_feed(passcode text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare rid uuid; dur int;
begin
  if not _presenter_ok(passcode) then raise exception 'invalid passcode' using errcode = '28000'; end if;
  select max(offset_s) into dur from demo_frames;
  if dur is null then raise exception 'demo feed not loaded'; end if;
  update runs set status = 'stopped', ended_at = now() where status = 'running' and mode = 'demo_feed';
  insert into runs (mode, label, duration_s, engine_version, model_version)
  values ('demo_feed', 'Cloud demo feed: fleet over Angers', dur,
          (select frame->>'engine_version' from demo_frames where frame ? 'engine_version' limit 1),
          (select frame->>'model_version' from demo_frames where frame ? 'model_version' limit 1))
  returning id into rid;
  perform demo_tick();
  return rid;
end;
$$;
grant execute on function public.start_demo_feed(text), public.stop_demo_feed(text), public.check_presenter(text) to anon, authenticated;

-- 2. Loader for the cloud demo: fetches demo_fleet.json from the deployed
-- dashboard with pg_net, then fills devices, demo_frames and demo events.
create extension if not exists pg_net;

create or replace function public.request_demo_feed(url text)
returns bigint language sql security definer set search_path = public, extensions
as $$ select net.http_get(url := url, timeout_milliseconds := 60000); $$;

create or replace function public.load_demo_feed(request_id bigint)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare body jsonb; st int;
begin
  select status_code, content::jsonb into st, body from net._http_response where id = request_id;
  if st is null then return 'not ready'; end if;
  if st <> 200 then return 'http ' || st; end if;
  insert into devices (id, name, kind, profile, route_slug)
  select d->>'id', d->>'name', d->>'kind', d->>'profile', d->>'route_slug' from jsonb_array_elements(body->'devices') d
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, profile = excluded.profile, route_slug = excluded.route_slug;
  delete from demo_frames; delete from demo_incident_events;
  insert into demo_frames (device_id, offset_s, frame)
  select f->>'device_id', (f->>'offset_s')::int, f->'frame' from jsonb_array_elements(body->'frames') f;
  insert into demo_incident_events (device_id, offset_s, incident)
  select e->>'device_id', (e->>'offset_s')::int, e->'incident' from jsonb_array_elements(body->'events') e;
  return (select count(*) from demo_frames) || ' frames, ' || (select count(*) from demo_incident_events) || ' events';
end;
$$;
revoke all on function public.request_demo_feed(text), public.load_demo_feed(bigint) from public, anon, authenticated;
