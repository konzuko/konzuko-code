-- supabase/migrations/20240701100000_add_profiles_and_subscriptions.sql

-- Subscription Status Enum
create type public.subscription_status as enum ('trialing', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid');

-- Profiles Table
-- Stores public-facing user data and Stripe customer ID
create table public.profiles (
  id uuid not null primary key references auth.users on delete cascade,
  stripe_customer_id text
);
alter table public.profiles enable row level security;
create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- Subscriptions Table
-- Stores subscription data, synced from Stripe via webhooks
-- FIX: The primary key 'id' is now of type TEXT and will store the Stripe Subscription ID.
-- This is crucial for the webhook's upsert logic to function correctly.
create table public.subscriptions (
  id text not null primary key,
  user_id uuid not null references public.profiles on delete cascade,
  status public.subscription_status,
  metadata jsonb,
  price_id text,
  quantity integer,
  cancel_at_period_end boolean,
  created timestamptz not null default now(),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default now(),
  ended_at timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz
);
alter table public.subscriptions enable row level security;
create policy "Users can view their own subscription" on public.subscriptions for select using (auth.uid() = user_id);

-- Function to create a profile for each new user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

-- Trigger to call the function on new user creation
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
