-- 20240605130000_user_api_keys_rls.sql
-- Single source-of-truth migration:
-- • Creates user_api_keys table
-- • Encrypts api_key column with Vault secret "encryption_key"
-- • Enables RLS (self-access only)
-- • Adds helper functions get_user_api_key / set_user_api_key
-- • Conditionally records the migration in supabase_migrations.schema_migrations

/*─────────────────────────────────────────────*
 * 1) Required extensions                      *
 *─────────────────────────────────────────────*/
create extension if not exists "pgcrypto"      with schema "extensions";
create extension if not exists supabase_vault;         -- vault.secrets table

/*─────────────────────────────────────────────*
 * 2) Table                                    *
 *─────────────────────────────────────────────*/
create table if not exists public.user_api_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key bytea
);

/*─────────────────────────────────────────────*
 * 3) One-time TEXT → BYTEA conversion + ENC   *
 *─────────────────────────────────────────────*/
do $$
declare
  v_secret text;
begin
  select secret
    into v_secret
    from vault.secrets
   where name = 'encryption_key';

  if v_secret is null then
    raise exception 'Vault secret "encryption_key" not found';
  end if;

  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'user_api_keys'
         and column_name  = 'api_key'
         and data_type    = 'text'
     ) then
    execute format(
      'alter table public.user_api_keys
         alter column api_key type bytea
         using extensions.pgp_sym_encrypt(api_key, %L)',
      v_secret
    );
  end if;
end $$;

/*─────────────────────────────────────────────*
 * 4) Enable RLS                               *
 *─────────────────────────────────────────────*/
alter table public.user_api_keys enable row level security;

/*─────────────────────────────────────────────*
 * 5) Policies  (PG14-compatible, idempotent)  *
 *─────────────────────────────────────────────*/
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

/*─────────────────────────────────────────────*
 * 6) Helper functions  (SECURITY DEFINER)     *
 *─────────────────────────────────────────────*/
create or replace function set_user_api_key(
  p_user_id uuid,
  p_api_key text
) returns void
language plpgsql
security definer as $$
declare
  v_secret text := (
    select secret from vault.secrets where name = 'encryption_key'
  );
begin
  if v_secret is null then
    raise exception 'Vault secret "encryption_key" not found';
  end if;

  insert into public.user_api_keys (user_id, api_key)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(p_api_key, v_secret)
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
  v_secret text := (
    select secret from vault.secrets where name = 'encryption_key'
  );
  v_key text;
begin
  if v_secret is null then
    raise exception 'Vault secret "encryption_key" not found';
  end if;

  select extensions.pgp_sym_decrypt(api_key, v_secret)
    into v_key
    from public.user_api_keys
   where user_id = p_user_id;

  return coalesce(v_key, '');
end;
$$;

/*─────────────────────────────────────────────*
 * 7) Record migration as applied (safe check) *
 *─────────────────────────────────────────────*/
do $$
begin
  if exists (
         select 1
           from pg_catalog.pg_class  c
           join pg_catalog.pg_namespace n
             on n.oid = c.relnamespace
          where n.nspname = 'supabase_migrations'
            and c.relname = 'schema_migrations'
     ) then
    insert into supabase_migrations.schema_migrations (version, name)
    values ('20240605130000', 'user_api_keys_rls')
    on conflict do nothing;
  end if;
end $$;
