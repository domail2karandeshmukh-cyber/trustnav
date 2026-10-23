-- Lets the database fetch demo_fleet.json from the deployed dashboard.
create extension if not exists pg_net;

create or replace function public.request_demo_feed(url text)
returns bigint language sql security definer set search_path = public, extensions
as $$ select net.http_get(url := url, timeout_milliseconds := 60000); $$;
revoke all on function public.request_demo_feed(text) from public, anon, authenticated;
