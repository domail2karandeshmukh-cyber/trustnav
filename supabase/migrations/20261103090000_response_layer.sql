-- Response layer: the protected position and recommended action travel with each frame.
alter table public.frames add column if not exists response jsonb;

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
                          osnma, fix, sats, speed_mps, heading_deg, attack, attack_kind, features, why, response)
      select r.id, d.device_id, d.offset_s, r.started_at + make_interval(secs => d.offset_s),
             (d.frame->>'lat')::float8, (d.frame->>'lon')::float8, (d.frame->>'trust')::real, d.frame->>'st',
             (d.frame->>'rr')::real, (d.frame->>'mr')::real, (d.frame->>'hr')::real,
             d.frame->>'osnma', coalesce((d.frame->>'fix')::boolean, true), (d.frame->>'sats')::int,
             (d.frame->>'spd')::real, (d.frame->>'hdg')::real, (d.frame->>'atk')::boolean, d.frame->>'kind',
             d.frame->'f', d.frame->'why', d.frame->'resp'
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
