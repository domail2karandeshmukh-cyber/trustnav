-- Brute-force limit on the presenter passcode. The passcode functions are
-- intentionally callable by anon (the dashboard's presenter controls).
-- After 10 wrong passcodes in 10 minutes, every attempt is refused.
create table if not exists public.presenter_failures (at timestamptz not null default now());
alter table public.presenter_failures enable row level security;

create or replace function public._presenter_ok(passcode text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare ok boolean;
begin
  if (select count(*) from presenter_failures where at > now() - interval '10 minutes') >= 10 then
    raise exception 'too many attempts, try again in 10 minutes' using errcode = '28000';
  end if;
  select crypt(passcode, passcode_hash) = passcode_hash into ok from presenter_passcodes where id = 1;
  if not coalesce(ok, false) then
    insert into presenter_failures default values;
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
