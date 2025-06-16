-- HIGH SEVERITY FIX: Enable Row Level Security on the rate_limit_events table.
-- This prevents authenticated users from viewing or deleting the rate-limiting
-- activity of other users, closing a potential data leak.

-- 1. Enable Row Level Security on the table.
alter table public.rate_limit_events enable row level security;

-- 2. Create a policy that allows users to access ONLY their own records.
-- The 'service_role' key used by the Edge Function bypasses RLS, so it can
-- still insert records for any user. This policy applies to any client-side
-- queries that might be attempted.
create policy "Users can only access their own rate limit events"
  on public.rate_limit_events for all
  using ( auth.uid() = user_id );

-- 3. Grant permissions to the 'authenticated' role.
-- While the policy is the primary security mechanism, this explicitly grants
-- the necessary permissions for the policy to be effective.
grant select, insert, update, delete on public.rate_limit_events to authenticated;
