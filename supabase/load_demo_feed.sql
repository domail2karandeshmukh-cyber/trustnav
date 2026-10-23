-- Load the cloud demo from the deployed dashboard (run as the project owner).
-- Step 1: select public.request_demo_feed('https://trustnav.vercel.app/data/demo_fleet.json');
-- Step 2 (a few seconds later), with :rid = the id returned by step 1:
with b as (select content::jsonb j from net._http_response where id = :rid and status_code = 200),
dv as (
  insert into public.devices (id, name, kind, profile, route_slug)
  select d->>'id', d->>'name', d->>'kind', d->>'profile', d->>'route_slug'
  from b, jsonb_array_elements(b.j->'devices') d
  on conflict (id) do update set name = excluded.name, kind = excluded.kind,
    profile = excluded.profile, route_slug = excluded.route_slug
  returning 1)
select count(*) from dv;

with b as (select content::jsonb j from net._http_response where id = :rid and status_code = 200),
fr as (
  insert into public.demo_frames (device_id, offset_s, frame)
  select f->>'device_id', (f->>'offset_s')::int, f->'frame' from b, jsonb_array_elements(b.j->'frames') f
  on conflict (device_id, offset_s) do update set frame = excluded.frame
  returning 1),
ev as (
  insert into public.demo_incident_events (device_id, offset_s, incident)
  select e->>'device_id', (e->>'offset_s')::int, e->'incident' from b, jsonb_array_elements(b.j->'events') e
  returning 1)
select (select count(*) from fr) frames, (select count(*) from ev) events;
