-- file: supabase/migrations/20240521120000_encrypt_api_keys.sql
-- Enable the pgcrypto extension if it's not already enabled.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

-- Add a secret key to your Supabase project's Vault secrets at
-- https://app.supabase.com/project/_/settings/vault
-- Key name: ENCRYPTION_KEY
-- It's recommended to use a long, random string.

-- Alter the table to change the api_key column type to bytea for storing encrypted data.
-- This migration will encrypt any existing keys.
ALTER TABLE "public"."user_api_keys"
ALTER COLUMN "api_key" TYPE bytea
USING extensions.pgp_sym_encrypt(api_key, current_setting('secrets.encryption_key'));

-- Create a function to securely set (upsert) a user's API key.
-- This function runs with the privileges of the user who defined it (the admin),
-- allowing it to access the encryption key from secrets.
CREATE OR REPLACE FUNCTION set_user_api_key(p_user_id uuid, p_api_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_api_keys (user_id, api_key)
  VALUES (p_user_id, extensions.pgp_sym_encrypt(p_api_key, current_setting('secrets.encryption_key')))
  ON CONFLICT (user_id)
  DO UPDATE SET api_key = EXCLUDED.api_key;
END;
$$;

-- Create a function to securely retrieve and decrypt a user's API key.
CREATE OR REPLACE FUNCTION get_user_api_key(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_api_key text;
BEGIN
  SELECT extensions.pgp_sym_decrypt(api_key, current_setting('secrets.encryption_key'))
  INTO v_api_key
  FROM public.user_api_keys
  WHERE user_id = p_user_id;
  RETURN v_api_key;
END;
$$;
