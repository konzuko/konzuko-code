/*───────────────────────────────────────────────────────────────────────────
  Rate-limiter table + pg_cron purge job
───────────────────────────────────────────────────────────────────────────*/

-- 1) Table (same definition used by the helper)
create table if not exists public.rate_limit_events (
  user_id   uuid        not null,
  endpoint  text        not null,
  ts        timestamptz not null default now()
);
create index if not exists rate_limit_events_idx
  on public.rate_limit_events (user_id, endpoint, ts);

-- 2) Ensure pg_cron extension (installs in schema "cron")
create extension if not exists pg_cron with schema cron;

-- 3) Grant usage so the cron worker can see the public schema (one-time)
grant usage on schema public to postgres;

-- 4) Schedule (or replace) the purge job
do $$
declare
  job_id int;
begin
  /* Does a job with this name already exist? */
  select jobid
    into job_id
    from cron.job
   where jobname = 'purge_rate_limit';

  if job_id is null then
    -- create new job (runs once per minute)
    perform
      cron.schedule(
        'purge_rate_limit',            -- job name
        '*/1 * * * *',                 -- crontab expression
        $$delete from public.rate_limit_events
            where ts < now() - interval '10 minutes'$$
      );
  else
    -- job exists: update the schedule/command in case they changed
    perform
      cron.alter_job(
        job_id,
        schedule => '*/1 * * * *',
        command  => $$delete from public.rate_limit_events
                       where ts < now() - interval '10 minutes'$$
      );
  end if;
end$$;
