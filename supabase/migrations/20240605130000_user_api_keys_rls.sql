-- 2024-06-05 13:00  –  single source-of-truth migration
--------------------------------------------------------

create extension if not exists "pgcrypto" with schema "extensions";

create table if not exists public.user_api_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key bytea
);

-- Convert legacy TEXT → BYTEA & encrypt (runs only once)
do $$
begin
  if exists (
    select 1
    from   information_schema.columns
    where  table_schema = 'public'
      and  table_name   = 'user_api_keys'
      and  column_name  = 'api_key'
      and  data_type    = 'text'
  )
  then
    alter table public.user_api_keys
      alter column api_key type bytea
      using extensions.pgp_sym_encrypt(
        api_key,
        current_setting('secrets.encryption_key')
      );
  end if;
end $$;

alter table public.user_api_keys enable row level security;

------------------------------------------------------------------
-- 5)  RLS policies (idempotent  – PG14-compatible)
------------------------------------------------------------------
drop policy if exists ua_select_own_api_key  on public.user_api_keys;
drop policy if exists ua_insert_own_api_key  on public.user_api_keys;
drop policy if exists ua_update_own_api_key  on public.user_api_keys;

create policy ua_select_own_api_key
  on public.user_api_keys
  for select
  using (auth.uid() = user_id);

create policy ua_insert_own_api_key
  on public.user_api_keys
  for insert
  with check (auth.uid() = user_id);

create policy ua_update_own_api_key
  on public.user_api_keys
  for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

------------------------------------------------------------------
-- 6)  Helper functions  (SECURITY DEFINER)
------------------------------------------------------------------
create or replace function set_user_api_key(
  p_user_id uuid,
  p_api_key text
) returns void
language plpgsql
security definer as $$
begin
  insert into public.user_api_keys (user_id, api_key)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(
      p_api_key,
      current_setting('secrets.encryption_key')
    )
  )
  on conflict (user_id)
  do update
    set api_key = excluded.api_key;
end;
$$;

create or replace function get_user_api_key(
  p_user_id uuid
) returns text
language plpgsql
security definer as $$
declare
  v_key text;
begin
  select extensions.pgp_sym_decrypt(
           api_key,
           current_setting('secrets.encryption_key')
         )
    into v_key
    from public.user_api_keys
   where user_id = p_user_id;

  return coalesce(v_key, '');
end;
$$;
