create extension if not exists pg_cron;

-- Start the one-click cloud demo: replays precomputed engine output at 1 Hz
-- with fresh timestamps, so the dashboard receives it exactly like live data.
create or replace function public.start_demo_feed(passcode text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ok boolean;
  rid uuid;
  dur int;
begin
  select crypt(passcode, passcode_hash) = passcode_hash into ok from presenter_passcodes where id = 1;
  if not coalesce(ok, false) then
    raise exception 'invalid passcode' using errcode = '28000';
  end if;
  update runs set status = 'stopped', ended_at = now() where status = 'running' and mode = 'demo_feed';
  select max(offset_s) into dur from demo_frames;
  insert into runs (mode, label, duration_s, engine_version, model_version)
  values ('demo_feed', 'Cloud demo feed: fleet over Angers', dur,
          (select frame->>'engine_version' from demo_frames where offset_s = 0 limit 1),
          (select frame->>'model_version' from demo_frames where offset_s = 0 limit 1))
  returning id into rid;
  perform demo_tick();
  return rid;
end;
$$;

create or replace function public.stop_demo_feed(passcode text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare ok boolean;
begin
  select crypt(passcode, passcode_hash) = passcode_hash into ok from presenter_passcodes where id = 1;
  if not coalesce(ok, false) then
    raise exception 'invalid passcode' using errcode = '28000';
  end if;
  update runs set status = 'stopped', ended_at = now() where status = 'running' and mode = 'demo_feed';
end;
$$;

create or replace function public.check_presenter(passcode text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce((select crypt(passcode, passcode_hash) = passcode_hash from presenter_passcodes where id = 1), false);
$$;

-- Called every second by pg_cron. Catches up if a tick is missed.
create or replace function public.demo_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  upto int;
begin
  for r in select * from runs where status = 'running' and mode = 'demo_feed' loop
    upto := least(floor(extract(epoch from now() - r.started_at))::int, r.duration_s);
    if upto > r.last_offset then
      insert into frames (run_id, device_id, seq, t, lat, lon, trust, status, rule_risk, ml_risk, hybrid_risk,
                          osnma, fix, sats, speed_mps, heading_deg, attack, attack_kind, features, why)
      select r.id, d.device_id, d.offset_s, r.started_at + make_interval(secs => d.offset_s),
             (d.frame->>'lat')::float8, (d.frame->>'lon')::float8, (d.frame->>'trust')::real, d.frame->>'st',
             (d.frame->>'rr')::real, (d.frame->>'mr')::real, (d.frame->>'hr')::real,
             d.frame->>'osnma', coalesce((d.frame->>'fix')::boolean, true), (d.frame->>'sats')::int,
             (d.frame->>'spd')::real, (d.frame->>'hdg')::real, (d.frame->>'atk')::boolean, d.frame->>'kind',
             d.frame->'f', d.frame->'why'
      from demo_frames d
      where d.offset_s > r.last_offset and d.offset_s <= upto
      on conflict (run_id, device_id, seq) do nothing;

      insert into incidents (run_id, device_id, scenario, severity, status, title, start_seq, end_seq,
                             opened_at, closed_at, min_trust, observations, evidence, updated_at)
      select distinct on (e.device_id, (e.incident->>'start')::int)
             r.id, e.device_id, e.incident->>'scenario', e.incident->>'severity', e.incident->>'status',
             e.incident->>'title', (e.incident->>'start')::int, (e.incident->>'end')::int,
             r.started_at + make_interval(secs => (e.incident->>'start')::int),
             case when e.incident->>'status' = 'RESOLVED' then r.started_at + make_interval(secs => e.offset_s) end,
             (e.incident->>'min_trust')::real, (e.incident->>'observations')::int, e.incident->'evidence', now()
      from demo_incident_events e
      where e.offset_s > r.last_offset and e.offset_s <= upto
      order by e.device_id, (e.incident->>'start')::int, e.offset_s desc
      on conflict (run_id, device_id, start_seq) do update set
        severity = excluded.severity, status = excluded.status, title = excluded.title,
        end_seq = excluded.end_seq, closed_at = excluded.closed_at, min_trust = excluded.min_trust,
        observations = excluded.observations, evidence = excluded.evidence, updated_at = now();

      update runs set last_offset = upto where id = r.id;
    end if;
    if upto >= r.duration_s then
      update runs set status = 'finished', ended_at = now() where id = r.id;
    end if;
  end loop;
end;
$$;

-- keep the free-tier database small: live frames older than 3 days are dropped
create or replace function public.prune_old_frames()
returns void language sql security definer set search_path = public as $$
  delete from runs where started_at < now() - interval '3 days';
$$;

revoke all on function public.demo_tick() from public, anon, authenticated;
revoke all on function public.prune_old_frames() from public, anon, authenticated;
grant execute on function public.start_demo_feed(text) to anon, authenticated;
grant execute on function public.stop_demo_feed(text) to anon, authenticated;
grant execute on function public.check_presenter(text) to anon, authenticated;

select cron.schedule('trustnav-demo-tick', '1 seconds', 'select public.demo_tick()');
select cron.schedule('trustnav-prune', '17 3 * * *', 'select public.prune_old_frames()');
