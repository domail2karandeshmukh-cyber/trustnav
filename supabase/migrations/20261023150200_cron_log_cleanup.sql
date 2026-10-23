-- NOT YET APPLIED. The 1-second demo tick writes one pg_cron log row per run;
-- this keeps only the last hour and trims old passcode failures.
create or replace function public.trim_cron_logs()
returns void language sql security definer set search_path = public, cron
as $$
  delete from cron.job_run_details where end_time < now() - interval '1 hour';
  delete from public.presenter_failures where at < now() - interval '1 day';
$$;
revoke all on function public.trim_cron_logs() from public, anon, authenticated;
select cron.schedule('trustnav-trim-logs', '*/10 * * * *', 'select public.trim_cron_logs()');
